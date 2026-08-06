'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Finding, ModuleAvailability, ScanModule } from './types';
import { bluetoothAvailability, scanBluetoothOnce } from './bluetooth-module';
import { networkAvailability, scanNetworkOnce } from './network-module';
import { magneticAvailability, scanMagneticOnce, type MagneticProgress } from './magnetic-module';
import { opticalAvailability, startOpticalScan, type OpticalHandle, type OpticalProgress } from './optical-module';
import { computeRiskLevel, type RiskLevel } from './risk';

export interface ModuleRunState {
  running: boolean;
  done: boolean;
  findingCount: number;
}

export interface ScanEngineState {
  isScanning: boolean;
  modules: Record<ScanModule, ModuleRunState>;
  findings: Finding[];
  availability: Record<ScanModule, ModuleAvailability>;
  riskLevel: RiskLevel;
  error: string | null;
  // Live sensor data for display
  opticalProgress: OpticalProgress | null;
  magneticProgress: MagneticProgress | null;
}

const IDLE_MODULE: ModuleRunState = { running: false, done: false, findingCount: 0 };

const SSR_SAFE_AVAIL: Record<ScanModule, ModuleAvailability> = {
  network:   { module: 'network',   supported: false, permissionState: 'unknown' },
  bluetooth: { module: 'bluetooth', supported: false, permissionState: 'unknown' },
  optical:   { module: 'optical',   supported: false, permissionState: 'unknown' },
  magnetic:  { module: 'magnetic',  supported: false, permissionState: 'unknown' },
};

const INITIAL_MODULES: Record<ScanModule, ModuleRunState> = {
  network: IDLE_MODULE, bluetooth: IDLE_MODULE,
  optical: IDLE_MODULE, magnetic: IDLE_MODULE,
};

export function useScanEngine(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<ScanEngineState>({
    isScanning: false,
    modules: INITIAL_MODULES,
    findings: [],
    availability: SSR_SAFE_AVAIL,
    riskLevel: 'clear',
    error: null,
    opticalProgress: null,
    magneticProgress: null,
  });

  // Detect client-side availability after hydration
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      availability: {
        network:   networkAvailability(),
        bluetooth: bluetoothAvailability(),
        optical:   opticalAvailability(),
        magnetic:  magneticAvailability(),
      },
    }));
  }, []);

  const opticalHandleRef = useRef<OpticalHandle | null>(null);
  const magneticStopRef  = useRef<(() => void) | null>(null);

  // ── vibration ─────────────────────────────────────────────────────────────
  const vibrate = useCallback((severity: Finding['severity']) => {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    const patterns: Record<Finding['severity'], number | number[]> = {
      info: 80, suspicious: [200, 100, 200], high: [300, 100, 300, 100, 300],
    };
    try { navigator.vibrate(patterns[severity]); } catch { /* ignore */ }
  }, []);

  // ── push finding ──────────────────────────────────────────────────────────
  const pushFinding = useCallback((finding: Finding) => {
    setState((prev) => {
      const isDuplicate = prev.findings.some(
        (f) => f.module === finding.module && f.title === finding.title,
      );
      if (isDuplicate) return prev;
      vibrate(finding.severity);
      const findings = [...prev.findings, finding];
      const mod = finding.module as ScanModule;
      return {
        ...prev,
        findings,
        riskLevel: computeRiskLevel(findings),
        modules: { ...prev.modules, [mod]: { ...prev.modules[mod], findingCount: prev.modules[mod].findingCount + 1 } },
      };
    });
  }, [vibrate]);

  // ── module running state ──────────────────────────────────────────────────
  const setModuleRunning = useCallback((mod: ScanModule, running: boolean, done = false) => {
    setState((prev) => ({
      ...prev,
      modules: { ...prev.modules, [mod]: { ...prev.modules[mod], running, done } },
      isScanning: running
        ? true
        : Object.entries({ ...prev.modules, [mod]: { ...prev.modules[mod], running } })
            .some(([, v]) => (v as ModuleRunState).running),
    }));
  }, []);

  // ── OPTICAL ───────────────────────────────────────────────────────────────
  const startOptical = useCallback(async () => {
    // The <video> element must be in the DOM before we call this.
    // We retry briefly in case React hasn't committed it yet.
    let video = videoRef.current;
    if (!video) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      video = videoRef.current;
    }
    if (!video) {
      setState((prev) => ({ ...prev, error: 'No se encontró el elemento de vídeo. Recarga la página.' }));
      return;
    }
    if (opticalHandleRef.current) return; // already running
    setModuleRunning('optical', true);
    setState((prev) => ({ ...prev, opticalProgress: null, error: null }));
    try {
      opticalHandleRef.current = await startOpticalScan(
        video,
        pushFinding,
        (progress) => setState((prev) => ({ ...prev, opticalProgress: progress })),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      setState((prev) => ({
        ...prev,
        error: msg.includes('Permission') || msg.includes('NotAllowed')
          ? 'Permiso de cámara denegado. Ve a los ajustes del navegador y permite el acceso a la cámara.'
          : `No se pudo iniciar la cámara: ${msg}`,
      }));
      setModuleRunning('optical', false, true);
    }
  }, [videoRef, pushFinding, setModuleRunning]);

  const stopOptical = useCallback(() => {
    opticalHandleRef.current?.stop();
    opticalHandleRef.current = null;
    setState((prev) => ({ ...prev, opticalProgress: null }));
    setModuleRunning('optical', false, true);
  }, [setModuleRunning]);

  // ── MAGNETIC ──────────────────────────────────────────────────────────────
  const startMagnetic = useCallback(async () => {
    if (magneticStopRef.current) return;
    setModuleRunning('magnetic', true);
    setState((prev) => ({ ...prev, magneticProgress: null, error: null }));
    try {
      magneticStopRef.current = await scanMagneticOnce(
        pushFinding,
        (progress) => setState((prev) => ({ ...prev, magneticProgress: progress })),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setState((prev) => ({ ...prev, error: msg || 'No se pudo iniciar el magnetómetro.' }));
      setModuleRunning('magnetic', false, true);
    }
  }, [pushFinding, setModuleRunning]);

  const stopMagnetic = useCallback(() => {
    magneticStopRef.current?.();
    magneticStopRef.current = null;
    setState((prev) => ({ ...prev, magneticProgress: null }));
    setModuleRunning('magnetic', false, true);
  }, [setModuleRunning]);

  // ── NETWORK ───────────────────────────────────────────────────────────────
  const startNetwork = useCallback(async () => {
    setModuleRunning('network', true);
    try { await scanNetworkOnce(pushFinding); }
    finally { setModuleRunning('network', false, true); }
  }, [pushFinding, setModuleRunning]);

  // ── BLUETOOTH ─────────────────────────────────────────────────────────────
  const runBluetoothPrompt = useCallback(async () => {
    setModuleRunning('bluetooth', true);
    try {
      await scanBluetoothOnce(pushFinding);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const cancelled = msg.toLowerCase().includes('cancel') ||
        msg.toLowerCase().includes('chose') ||
        msg.toLowerCase().includes('user');
      if (!cancelled && msg) setState((prev) => ({ ...prev, error: msg }));
    } finally {
      setModuleRunning('bluetooth', false, true);
    }
  }, [pushFinding, setModuleRunning]);

  // ── START ALL ─────────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    setState((prev) => ({ ...prev, isScanning: true, error: null }));
    await Promise.all([startOptical(), startMagnetic(), startNetwork()]);
  }, [startOptical, startMagnetic, startNetwork]);

  // ── STOP ALL ──────────────────────────────────────────────────────────────
  const stopScan = useCallback(() => {
    stopOptical();
    stopMagnetic();
    setState((prev) => ({ ...prev, isScanning: false }));
  }, [stopOptical, stopMagnetic]);

  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      findings: [], riskLevel: 'clear', error: null,
      modules: INITIAL_MODULES, opticalProgress: null, magneticProgress: null,
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      opticalHandleRef.current?.stop();
      magneticStopRef.current?.();
    };
  }, []);

  return {
    state,
    startOptical, stopOptical,
    startMagnetic, stopMagnetic,
    startNetwork,
    runBluetoothPrompt,
    startScan, stopScan, reset,
  };
}
