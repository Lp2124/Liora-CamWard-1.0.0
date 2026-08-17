/**
 * Liora CamWard — Inspección Integral coordinator.
 *
 * This route coordinates the real inspection engines. Individual modules own
 * their acquisition logic; this screen must reuse those engines rather than
 * duplicate sensor implementations.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { useScanStore } from '../src/store/scan-store';
import {
  startMagneticScanNative,
  type MagneticNativeProgress,
  type MagneticScanHandle,
} from '../src/modules/magnetic/magnetometer-native';
import { scanBleWindow } from '../src/modules/ble/ble-scanner';
import {
  createInspection,
  submitBleObservation,
  submitMagneticObservation,
} from '../src/api/client';
import type { RiskLevel } from '@liora/contracts';

const DEVICE_FINGERPRINT = randomUUID();

export default function IntegralInspectionScreen() {
  const magneticHandleRef = useRef<MagneticScanHandle | null>(null);
  const magneticIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestMagneticProgressRef = useRef<MagneticNativeProgress | null>(null);
  const magneticSubmittedRef = useRef(false);

  const {
    phase,
    findings,
    riskResult,
    magneticProgress,
    bleDevicesFound,
    error,
    setPhase,
    setInspectionId,
    addFindings,
    setMagneticProgress,
    setBleDevicesFound,
    setError,
    markModuleComplete,
    reset,
  } = useScanStore();

  const clearMagneticInterval = useCallback(() => {
    if (magneticIntervalRef.current) {
      clearInterval(magneticIntervalRef.current);
      magneticIntervalRef.current = null;
    }
  }, []);

  const stopNativeResources = useCallback(() => {
    clearMagneticInterval();
    magneticHandleRef.current?.stop();
    magneticHandleRef.current = null;
    latestMagneticProgressRef.current = null;
  }, [clearMagneticInterval]);

  useEffect(() => () => stopNativeResources(), [stopNativeResources]);

  const startScan = useCallback(async () => {
    stopNativeResources();
    reset();
    setError(null);
    setPhase('scanning');
    magneticSubmittedRef.current = false;

    let inspectionId: string | null = null;
    try {
      const inspection = await createInspection({ label: new Date().toLocaleString('es') });
      inspectionId = inspection.inspectionId;
      setInspectionId(inspectionId);
    } catch {
      setError('Sensores activos localmente. Sin sincronización con servidor en esta inspección.');
    }

    startMagneticScanNative((progress) => {
      latestMagneticProgressRef.current = progress;
      setMagneticProgress(progress);
      if (progress.phase === 'unavailable' || progress.phase === 'error') {
        clearMagneticInterval();
        magneticHandleRef.current?.stop();
        magneticHandleRef.current = null;
        markModuleComplete('magnetic');
      }
    })
      .then((handle) => {
        magneticHandleRef.current = handle;
        magneticIntervalRef.current = setInterval(async () => {
          const progress = latestMagneticProgressRef.current;
          if (!progress || progress.phase !== 'monitoring' || magneticSubmittedRef.current) return;

          const samples = handle.getSamples();
          if (samples.length === 0) return;

          magneticSubmittedRef.current = true;
          clearMagneticInterval();
          handle.stop();
          magneticHandleRef.current = null;

          if (!inspectionId) {
            markModuleComplete('magnetic');
            return;
          }

          try {
            const result = await submitMagneticObservation({
              inspectionId,
              captureNonce: randomUUID(),
              clientTimestamp: new Date().toISOString(),
              phase: 'monitoring',
              samples,
              deviceFingerprint: DEVICE_FINGERPRINT,
            });
            addFindings(result.findings, result.riskContribution);
          } catch {
            setError('Lectura magnética capturada localmente; no fue posible sincronizarla.');
          } finally {
            markModuleComplete('magnetic');
          }
        }, 500);
      })
      .catch(() => markModuleComplete('magnetic'));

    let bleSeenCount = 0;
    scanBleWindow(12000, () => {
      bleSeenCount += 1;
      setBleDevicesFound(bleSeenCount);
    })
      .then(async (result) => {
        if (inspectionId && result.devices.length > 0) {
          try {
            const analysis = await submitBleObservation({
              inspectionId,
              captureNonce: randomUUID(),
              clientTimestamp: new Date().toISOString(),
              devices: result.devices,
              deviceFingerprint: DEVICE_FINGERPRINT,
            });
            addFindings(analysis.findings, analysis.riskContribution);
          } catch {
            setError('Exploración BLE realizada localmente; no fue posible sincronizarla.');
          }
        }
        markModuleComplete('ble');
      })
      .catch(() => markModuleComplete('ble'));
  }, [
    addFindings,
    clearMagneticInterval,
    markModuleComplete,
    reset,
    setBleDevicesFound,
    setError,
    setInspectionId,
    setMagneticProgress,
    setPhase,
    stopNativeResources,
  ]);

  const stopScan = useCallback(() => {
    stopNativeResources();
    setPhase('completed');
  }, [setPhase, stopNativeResources]);

  useEffect(() => {
    const lastFinding = findings[findings.length - 1];
    if (lastFinding?.severity === 'suspicious') Vibration.vibrate([200, 100, 200]);
    if (lastFinding?.severity === 'high') Vibration.vibrate([300, 100, 300, 100, 300]);
  }, [findings]);

  const riskColor = getRiskColor(riskResult?.level ?? 'none');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Inspección Integral</Text>
        <Text style={styles.subtitle}>Coordinador de motores reales. Óptico y Red se incorporarán aquí cuando sus motores pasen sus gates propios.</Text>
      </View>

      <View style={[styles.riskBanner, { borderColor: riskColor }]}>
        <Text style={[styles.riskLabel, { color: riskColor }]}>
          {riskResult ? getRiskLabel(riskResult.level) : 'Sin clasificación de servidor'}
        </Text>
        {riskResult && <Text style={styles.riskScore}>Score: {riskResult.score}/100</Text>}
      </View>

      <ScrollView style={styles.modules} contentContainerStyle={styles.modulesContent}>
        <ModuleStatus
          label="Detección Magnética"
          status={
            magneticProgress?.phase === 'calibrating'
              ? `Calibrando... ${magneticProgress.secondsRemainingCalibration}s`
              : magneticProgress?.phase === 'monitoring'
                ? `${magneticProgress.currentMicroTesla} µT (Δ${magneticProgress.signedDelta ?? 0} µT)`
                : magneticProgress?.phase === 'unavailable'
                  ? 'Sensor no disponible'
                  : magneticProgress?.phase === 'error'
                    ? 'Lectura inválida/saturada'
                    : 'Esperando...'
          }
        />
        <ModuleStatus
          label="Exploración Bluetooth"
          status={bleDevicesFound > 0 ? `${bleDevicesFound} observaciones BLE` : phase === 'scanning' ? 'Explorando...' : 'Inactivo'}
        />

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {findings.length > 0 && (
          <View style={styles.findings}>
            <Text style={styles.findingsTitle}>Hallazgos ({findings.length})</Text>
            {findings.map((finding, index) => (
              <View key={finding.id ?? index} style={[styles.finding, getSeverityStyle(finding.severity)]}>
                <Text style={styles.findingTitle}>{finding.title}</Text>
                <Text style={styles.findingDetail} numberOfLines={3}>{finding.detail}</Text>
              </View>
            ))}
          </View>
        )}

        {riskResult?.nextRecommendation && (
          <View style={styles.recommendationBox}>
            <Text style={styles.recommendationLabel}>Recomendación</Text>
            <Text style={styles.recommendationText}>{riskResult.nextRecommendation}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.controls}>
        {phase === 'idle' || phase === 'completed' || phase === 'error' ? (
          <TouchableOpacity style={styles.scanButton} onPress={startScan}>
            <Text style={styles.scanButtonText}>{phase === 'idle' ? 'Iniciar inspección integral' : 'Nueva inspección integral'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopScan}>
            <Text style={styles.stopButtonText}>Detener inspección</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function ModuleStatus({ label, status }: { label: string; status: string }) {
  return (
    <View style={styles.moduleStatus}>
      <Text style={styles.moduleLabel}>{label}</Text>
      <Text style={styles.moduleValue}>{status}</Text>
    </View>
  );
}

function getRiskColor(level: RiskLevel): string {
  const colors: Record<RiskLevel, string> = {
    none: '#666',
    informational: '#00aaff',
    low: '#00ff88',
    medium: '#ffaa00',
    high: '#ff4400',
    critical: '#ff0044',
  };
  return colors[level];
}

function getRiskLabel(level: RiskLevel): string {
  const labels: Record<RiskLevel, string> = {
    none: 'Sin evidencia concluyente',
    informational: 'Informativo',
    low: 'Riesgo bajo',
    medium: 'Riesgo moderado',
    high: 'Riesgo alto',
    critical: 'Riesgo crítico',
  };
  return labels[level];
}

function getSeverityStyle(severity: string): object {
  if (severity === 'high') return { borderLeftColor: '#ff0044' };
  if (severity === 'suspicious') return { borderLeftColor: '#ff8800' };
  return { borderLeftColor: '#333' };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { padding: 18, paddingBottom: 10 },
  title: { color: '#fff', fontSize: 21, fontWeight: '800' },
  subtitle: { color: '#777', fontSize: 12, lineHeight: 18, marginTop: 5 },
  riskBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingHorizontal: 16, borderBottomWidth: 1 },
  riskLabel: { fontSize: 14, fontWeight: '700' },
  riskScore: { fontSize: 12, color: '#666' },
  modules: { flex: 1 },
  modulesContent: { padding: 16 },
  moduleStatus: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  moduleLabel: { fontSize: 13, color: '#777' },
  moduleValue: { fontSize: 13, color: '#aaa', maxWidth: '65%', textAlign: 'right' },
  errorBox: { backgroundColor: '#1a1000', borderRadius: 8, padding: 12, marginTop: 16, borderLeftWidth: 3, borderLeftColor: '#ff8800' },
  errorText: { color: '#ddaa66', fontSize: 12 },
  findings: { marginTop: 16 },
  findingsTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 12 },
  finding: { backgroundColor: '#111', borderRadius: 8, padding: 12, marginBottom: 8, borderLeftWidth: 3 },
  findingTitle: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 4 },
  findingDetail: { fontSize: 11, color: '#888', lineHeight: 16 },
  recommendationBox: { backgroundColor: '#0a1a0a', borderRadius: 8, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#00ff8830' },
  recommendationLabel: { fontSize: 11, color: '#00ff88', fontWeight: '700', marginBottom: 6 },
  recommendationText: { fontSize: 13, color: '#ccc', lineHeight: 18 },
  controls: { padding: 16, paddingBottom: 24 },
  scanButton: { backgroundColor: '#00ff88', borderRadius: 12, padding: 18, alignItems: 'center' },
  scanButtonText: { fontSize: 15, fontWeight: '800', color: '#0a0a0a' },
  stopButton: { backgroundColor: '#1a0000', borderRadius: 12, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: '#ff0044' },
  stopButtonText: { fontSize: 15, fontWeight: '700', color: '#ff4444' },
});
