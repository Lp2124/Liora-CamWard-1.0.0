'use client';

import { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { RadarDisplay } from '@/components/scan/radar-display';
import { FindingCard } from '@/components/scan/finding-card';
import { OpticalMap } from '@/components/scan/optical-map';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n/context';
import { useAuth } from '@/lib/auth-context';
import { useScanEngine } from '@/lib/scan/use-scan-engine';
import type { Finding } from '@/lib/scan/types';
import {
  ShieldAlert, Camera, Compass, Wifi, Radio,
  Play, Square, CheckCircle2, AlertTriangle, FileDown, Plus, Loader2, Zap,
} from 'lucide-react';
import { toast } from 'sonner';

const RISK_LABEL: Record<string, string> = {
  clear: 'Sin señales de riesgo sobre umbral', low: 'Riesgo bajo',
  medium: 'Riesgo medio', high: 'RIESGO ALTO — REQUIERE INSPECCIÓN',
};
const RISK_COLOR: Record<string, string> = {
  clear: 'text-green-400', low: 'text-yellow-400', medium: 'text-orange-400', high: 'text-red-400',
};

function exportReport(findings: Finding[], riskLevel: string) {
  const date = new Date().toLocaleString('es-ES');
  const lines = [
    'LIORA CAMWARD — INFORME DE DETECCIÓN',
    `Fecha: ${date}`,
    `Nivel de riesgo: ${riskLevel.toUpperCase()}`,
    `Total hallazgos: ${findings.length}`,
    '',
    '─────────────────────────────────────',
    ...findings.flatMap((f, i) => [
      `[${i + 1}] ${f.severity.toUpperCase()} · ${f.module}`,
      `  ${f.title}`,
      `  ${f.detail}`,
      `  Evidencia: ${JSON.stringify(f.evidence)}`,
      '',
    ]),
    findings.length === 0
      ? 'No hubo hallazgos que superaran los umbrales configurados. Esto no descarta dispositivos no observados.'
      : '',
    '─────────────────────────────────────',
    'Liora CamWard · https://lioracamward.com',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `liora-camward-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ScanPage() {
  const { t } = useI18n();
  const { user, login } = useAuth();
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    state,
    startOptical, stopOptical,
    startMagnetic, stopMagnetic,
    startNetwork,
    runBluetoothPrompt,
    startScan, stopScan, reset,
  } = useScanEngine(videoRef);

  const { availability, modules, findings, riskLevel, isScanning, error, opticalProgress, magneticProgress } = state;

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    if (!user) {
      login();
      return null;
    }
    const res = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: null }),
    });
    const payload = await res.json();
    if (!payload.success) {
      toast.error(payload.error === 'SCAN_LIMIT_REACHED' ? t('scanLimitReached') : (payload.error ?? 'Error'));
      return null;
    }
    const id = payload.data.id as string;
    setSessionId(id);
    return id;
  }, [sessionId, user, login, t]);

  const handleFinish = async () => {
    stopScan();
    if (!sessionId) return;
    setSaving(true);
    try {
      const modulesRun = Array.from(new Set(findings.map((f) => f.module)));
      const res = await fetch(`/api/scans/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskLevel, modulesRun, findings }),
      });
      const payload = await res.json();
      if (payload.success) {
        toast.success(t('reportSaved'));
        router.push(`/history/${sessionId}`);
      } else {
        toast.error(payload.error ?? 'Error al guardar');
      }
    } finally {
      setSaving(false);
    }
  };

  const withSession = useCallback(async (action: () => Promise<void>) => {
    if (!user) {
      login();
      return;
    }
    const id = await ensureSession();
    if (!id) return;
    await action();
  }, [user, login, ensureSession]);

  const handleStartAll = async () => {
    const id = await ensureSession();
    if (!id) return;
    reset();
    await startScan();
  };

  const [btRounds, setBtRounds] = useState(0);
  const handleBluetooth = useCallback(async () => {
    await withSession(runBluetoothPrompt);
    setBtRounds((n) => n + 1);
  }, [withSession, runBluetoothPrompt]);

  const mf = (mod: string) => findings.filter((f) => f.module === mod);

  const MagneticLive = () => {
    if (!modules.magnetic.running || !magneticProgress) return null;
    const { phase, currentMicroTesla, baselineMicroTesla, signedDelta, secondsRemaining } = magneticProgress;
    const danger = signedDelta != null && signedDelta > 20;
    const barPct = Math.min(100, signedDelta != null ? Math.max(0, (signedDelta / 60) * 100) : 0);
    return (
      <div className="mx-4 mb-4 flex flex-col gap-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
        {phase === 'baseline' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-violet-400" aria-hidden />
            <span>Calibrando línea base… {secondsRemaining}s · {currentMicroTesla} µT</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Campo actual</span>
              <span className={`font-mono font-semibold ${danger ? 'text-amber-400' : 'text-violet-300'}`}>
                {currentMicroTesla} µT
                {signedDelta != null && signedDelta > 0 && (
                  <span className="ml-1 text-[10px] opacity-70">(+{signedDelta} vs base)</span>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-border/40">
              <div
                className={`h-full rounded-full transition-all duration-200 ${danger ? 'bg-amber-400' : 'bg-violet-400'}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Base: {baselineMicroTesla} µT · Umbral de alerta: +25 µT · Mueve el teléfono lentamente
            </p>
          </>
        )}
      </div>
    );
  };

  const OpticalLive = () => {
    if (!modules.optical.running) return null;
    return (
      <div className="absolute left-3 top-3 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-cyan-400">
          <span className="size-1.5 animate-ping rounded-full bg-cyan-400" aria-hidden />
          {opticalProgress ? (
            <span>
              {opticalProgress.torchActive ? '⚡ Flash ON' : '🔦 Sin flash'} · {opticalProgress.framesAnalyzed} frames
            </span>
          ) : (
            <span>Iniciando cámara…</span>
          )}
        </div>
        {opticalProgress && opticalProgress.clustersFound > 0 && (
          <div className="flex items-center gap-1 rounded-full bg-amber-500/80 px-2.5 py-1 text-[10px] font-semibold text-black">
            <Zap className="size-3" aria-hidden />
            {opticalProgress.clustersFound} cluster{opticalProgress.clustersFound !== 1 ? 's' : ''} brillante{opticalProgress.clustersFound !== 1 ? 's' : ''} ahora
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      <AppNav />

      <div className={modules.optical.running ? 'block' : 'hidden'} aria-hidden={!modules.optical.running} />

      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
        <div className="relative overflow-hidden rounded-2xl">
          <img src="/hero-bg.png" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-35" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background/90" />
          <div className="relative z-10 px-6 py-10 text-center sm:py-12">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t('heroTitle')}</h1>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{t('heroSubtitle')}</p>
          </div>
        </div>

        <RadarDisplay active={isScanning} riskLevel={riskLevel} findingCount={findings.length} />
        <p className={`text-center font-display text-sm font-semibold uppercase tracking-widest ${RISK_COLOR[riskLevel]}`}>
          {RISK_LABEL[riskLevel]}
          {findings.filter((f) => f.severity !== 'info').length > 0 && (
            <Badge variant="outline" className="ml-2 text-xs">
              {findings.filter((f) => f.severity !== 'info').length} evidencia{findings.filter((f) => f.severity !== 'info').length !== 1 ? 's' : ''}
            </Badge>
          )}
        </p>

        <div className="flex flex-col items-center gap-2">
          {!isScanning ? (
            <Button size="lg" onClick={handleStartAll} className="w-full max-w-xs gap-2">
              <Play className="size-4" aria-hidden /> Iniciar escaneo completo
            </Button>
          ) : (
            <Button size="lg" variant="secondary" onClick={handleFinish} disabled={saving} className="w-full max-w-xs gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Square className="size-4" aria-hidden />}
              Terminar y guardar informe
            </Button>
          )}
          {findings.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={() => {
                exportReport(findings, riskLevel);
                toast.success('Informe descargado');
              }}
            >
              <FileDown className="size-3.5" aria-hidden /> Exportar informe
            </Button>
          )}
        </div>

        {riskLevel === 'high' && (() => {
          const alertMods = new Set(findings.filter((f) => f.severity !== 'info').map((f) => f.module));
          if (alertMods.size >= 2) return (
            <Alert className="border-red-500/40 bg-red-500/5">
              <ShieldAlert className="size-4 text-red-400" aria-hidden />
              <AlertTitle className="text-red-400">⚠ Corroboración multi-módulo</AlertTitle>
              <AlertDescription>
                {alertMods.size} sensores independientes detectaron evidencias simultáneamente
                ({Array.from(alertMods).join(' + ')}). Alta confianza — inspecciona visualmente la zona.
              </AlertDescription>
            </Alert>
          );
          return null;
        })()}

        {error && (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className={`rounded-2xl border bg-card/60 transition-colors ${
          modules.optical.running ? 'border-cyan-500/60 shadow-[0_0_20px_-4px_rgba(6,182,212,0.4)]'
            : mf('optical').some((f) => f.severity !== 'info') ? 'border-amber-500/50'
              : 'border-border/40'
        }`}>
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-600">
                <Camera className="size-5 text-white" aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display font-semibold">Cámara óptica</h2>
                  {modules.optical.running && <ActiveBadge />}
                  {modules.optical.done && !modules.optical.running && (
                    mf('optical').some((f) => f.severity !== 'info')
                      ? <SuspiciousBadge count={mf('optical').filter((f) => f.severity !== 'info').length} />
                      : <ClearBadge />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Detecta reflejos de lentes con el flash del teléfono</p>
              </div>
            </div>
            {!availability.optical.supported ? (
              <UnavailablePill />
            ) : modules.optical.running ? (
              <Button
                size="sm"
                variant="outline"
                onClick={stopOptical}
                className="shrink-0 gap-1.5 border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                <Square className="size-3" /> Detener
              </Button>
            ) : (
              <Button size="sm" onClick={() => withSession(startOptical)} disabled={modules.optical.running} className="shrink-0 gap-1.5">
                {modules.optical.done ? <Plus className="size-3" /> : <Play className="size-3" />}
                {modules.optical.done ? 'Reiniciar' : 'Iniciar'}
              </Button>
            )}
          </div>

          <div className={`relative mx-4 mb-4 overflow-hidden rounded-xl bg-black ${modules.optical.running ? 'block' : 'hidden'}`}>
            <video
              ref={videoRef}
              className="h-44 w-full object-cover sm:h-56"
              muted
              playsInline
              aria-label="Vista de cámara en vivo"
            />
            <OpticalLive />
            <p className="absolute bottom-2 left-0 right-0 text-center text-[11px] text-white/50">
              Apunta lentamente a espejos, cuadros, enchufes y detectores de humo
            </p>
          </div>

          {!modules.optical.running && !modules.optical.done && (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              Activa el flash y la cámara trasera para buscar reflejos de lentes ocultas.
              Funciona mejor en habitaciones con poca luz y moviendo el teléfono despacio.
            </p>
          )}
          {modules.optical.done && !modules.optical.running && mf('optical').some((f) => f.severity !== 'info') && (
            <div className="mx-4 mb-4"><OpticalMap findings={findings} /></div>
          )}
          {modules.optical.done && !modules.optical.running && !mf('optical').some((f) => f.severity !== 'info') && (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              No se observaron reflejos persistentes por encima del umbral durante esta captura. Esto no descarta dispositivos ocultos o fuera del campo de visión.
            </p>
          )}
          {mf('optical').length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/40 p-4">
              {mf('optical').map((f, i) => <FindingCard key={i} finding={f} />)}
            </div>
          )}
        </div>

        <div className={`rounded-2xl border bg-card/60 transition-colors ${
          modules.magnetic.running ? 'border-violet-500/60 shadow-[0_0_20px_-4px_rgba(139,92,246,0.4)]'
            : mf('magnetic').some((f) => f.severity !== 'info') ? 'border-amber-500/50'
              : 'border-border/40'
        }`}>
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-violet-600">
                <Compass className="size-5 text-white" aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display font-semibold">Sensor magnético</h2>
                  {modules.magnetic.running && <ActiveBadge color="violet" />}
                  {modules.magnetic.done && !modules.magnetic.running && (
                    mf('magnetic').some((f) => f.severity !== 'info')
                      ? <SuspiciousBadge count={mf('magnetic').filter((f) => f.severity !== 'info').length} />
                      : <ClearBadge />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {availability.magnetic.supported
                    ? 'Detecta anomalías de campo magnético causadas por electrónica cercana'
                    : 'Requiere Chrome en Android con Generic Sensor API'}
                </p>
              </div>
            </div>
            {!availability.magnetic.supported ? (
              <UnavailablePill />
            ) : modules.magnetic.running ? (
              <Button
                size="sm"
                variant="outline"
                onClick={stopMagnetic}
                className="shrink-0 gap-1.5 border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                <Square className="size-3" /> Detener
              </Button>
            ) : (
              <Button size="sm" onClick={() => withSession(startMagnetic)} disabled={modules.magnetic.running} className="shrink-0 gap-1.5">
                {modules.magnetic.done ? <Plus className="size-3" /> : <Play className="size-3" />}
                {modules.magnetic.done ? 'Reiniciar' : 'Iniciar'}
              </Button>
            )}
          </div>

          <MagneticLive />

          {!modules.magnetic.running && !modules.magnetic.done && availability.magnetic.supported && (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              Calibra el sensor durante 2.5s y luego monitorea en tiempo real. Mueve el teléfono
              cerca de enchufes, detrás de cuadros, detectores de humo y marcos metálicos.
            </p>
          )}
          {modules.magnetic.done && !modules.magnetic.running && !mf('magnetic').some((f) => f.severity !== 'info') && (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              No se observaron variaciones magnéticas por encima del umbral durante esta medición; el resultado no identifica ni descarta dispositivos por sí solo.
            </p>
          )}
          {mf('magnetic').length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/40 p-4">
              {mf('magnetic').map((f, i) => <FindingCard key={i} finding={f} />)}
            </div>
          )}
        </div>

        <div className={`rounded-2xl border bg-card/60 ${modules.network.running ? 'border-blue-500/60' : 'border-border/40'}`}>
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600">
                <Wifi className="size-5 text-white" aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display font-semibold">Red WiFi</h2>
                  {modules.network.running && <ActiveBadge color="blue" />}
                  {modules.network.done && !modules.network.running && <ClearBadge />}
                </div>
                <p className="text-xs text-muted-foreground">Detecta el tipo y contexto de la red actual</p>
              </div>
            </div>
            {modules.network.running ? (
              <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <Button size="sm" onClick={() => withSession(startNetwork)} className="shrink-0 gap-1.5">
                {modules.network.done ? <Plus className="size-3" /> : <Play className="size-3" />}
                {modules.network.done ? 'Repetir' : 'Analizar'}
              </Button>
            )}
          </div>
          {mf('network').length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/40 p-4">
              {mf('network').map((f, i) => <FindingCard key={i} finding={f} />)}
            </div>
          )}
        </div>

        <div className={`rounded-2xl border bg-card/60 ${
          modules.bluetooth.running ? 'border-indigo-500/60'
            : mf('bluetooth').some((f) => f.severity !== 'info') ? 'border-amber-500/50'
              : 'border-border/40'
        }`}>
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-600">
                <Radio className="size-5 text-white" aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display font-semibold">Bluetooth</h2>
                  {modules.bluetooth.running && <ActiveBadge color="indigo" />}
                  {btRounds > 0 && !modules.bluetooth.running && (
                    mf('bluetooth').some((f) => f.severity !== 'info')
                      ? <SuspiciousBadge count={mf('bluetooth').filter((f) => f.severity !== 'info').length} />
                      : <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
                          {btRounds} escaneado{btRounds !== 1 ? 's' : ''} · sin coincidencias sobre umbral
                        </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {availability.bluetooth.supported
                    ? 'Analiza dispositivos Bluetooth cercanos buscando indicadores compatibles con cámaras'
                    : 'Requiere Chrome en Android (Web Bluetooth API)'}
                </p>
              </div>
            </div>
            {!availability.bluetooth.supported ? (
              <UnavailablePill />
            ) : modules.bluetooth.running ? (
              <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <Button size="sm" onClick={handleBluetooth} className="shrink-0 gap-1.5">
                {btRounds > 0 ? <Plus className="size-3" /> : <Play className="size-3" />}
                {btRounds > 0 ? 'Otro dispositivo' : 'Escanear'}
              </Button>
            )}
          </div>
          {!modules.bluetooth.done && !modules.bluetooth.running && availability.bluetooth.supported && (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              Abre el selector de dispositivos del navegador. Elige cualquier dispositivo cercano para analizarlo.
              Puedes escanear varios uno a uno. Requiere interacción manual (limitación del navegador).
            </p>
          )}
          {btRounds > 0 && !modules.bluetooth.running && (
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              {btRounds} dispositivo{btRounds !== 1 ? 's' : ''} analizados. Pulsa “Otro dispositivo” para continuar.
            </p>
          )}
          {mf('bluetooth').length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/40 p-4">
              {mf('bluetooth').map((f, i) => <FindingCard key={i} finding={f} />)}
            </div>
          )}
        </div>

        <Alert>
          <ShieldAlert className="size-4" aria-hidden />
          <AlertTitle>{t('disclaimerTitle')}</AlertTitle>
          <AlertDescription>{t('disclaimerBody')}</AlertDescription>
        </Alert>
      </main>
    </div>
  );
}

function ActiveBadge({ color = 'cyan' }: { color?: string }) {
  const cls: Record<string, string> = {
    cyan: 'bg-cyan-500/10 text-cyan-400', violet: 'bg-violet-500/10 text-violet-400',
    blue: 'bg-blue-500/10 text-blue-400', indigo: 'bg-indigo-500/10 text-indigo-400',
  };
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls[color] ?? cls.cyan}`}>
      <span className="size-1.5 animate-ping rounded-full bg-current" aria-hidden />
      Activo
    </span>
  );
}

function ClearBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
      <CheckCircle2 className="size-3" aria-hidden /> Sin señal sobre umbral
    </span>
  );
}

function SuspiciousBadge({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
      <AlertTriangle className="size-3" aria-hidden /> {count} alerta{count !== 1 ? 's' : ''}
    </span>
  );
}

function UnavailablePill() {
  return <span className="shrink-0 rounded-lg border border-border/30 px-3 py-1.5 text-xs text-muted-foreground/40">No disponible</span>;
}
