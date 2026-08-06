import type { Finding, ModuleAvailability } from './types';

const BASELINE_SAMPLE_MS    = 2500;
const ANOMALY_DELTA_UT      = 25;   // lowered slightly: spy cameras can add 25-40µT
const ANOMALY_CONFIRM_COUNT = 3;
const BASELINE_DRIFT_CALM   = 0.04;
const BASELINE_DRIFT_ACTIVE = 0.004;

export interface MagneticProgress {
  phase: 'baseline' | 'monitoring';
  currentMicroTesla: number;
  baselineMicroTesla: number | null;
  signedDelta: number | null;
  secondsRemaining: number; // seconds left in baseline phase (0 when monitoring)
}

export function magneticAvailability(): ModuleAvailability {
  // Must run client-side only — window is not available during SSR
  if (typeof window === 'undefined') {
    return { module: 'magnetic', supported: false, permissionState: 'unknown' };
  }
  const w = window as unknown as { Magnetometer?: unknown };
  const supported = !!w.Magnetometer;
  return {
    module: 'magnetic',
    supported,
    permissionState: 'prompt',
    reason: supported
      ? undefined
      : 'Sensor de campo magnético no disponible. Requiere Chrome en Android con la Generic Sensor API habilitada.',
  };
}

export async function scanMagneticOnce(
  onFinding: (finding: Finding) => void,
  onProgress?: (p: MagneticProgress) => void,
): Promise<() => void> {
  if (typeof window === 'undefined') return () => {};

  const w = window as unknown as {
    Magnetometer?: new (opts?: { frequency?: number }) => {
      start(): void; stop(): void;
      x: number; y: number; z: number;
      addEventListener(type: 'reading' | 'error', cb: (e?: unknown) => void): void;
    };
  };

  if (!w.Magnetometer) {
    onFinding({
      module: 'magnetic', severity: 'info',
      title: 'Sensor magnético no disponible en este dispositivo/navegador',
      detail: 'La Generic Sensor API (Magnetometer) no está expuesta por este navegador. Para usarla necesitas Chrome en Android (no iOS, no Firefox, no Safari). El resto de módulos siguen activos.',
      evidence: { source: 'Magnetometer API', result: 'unsupported' },
    });
    return () => {};
  }

  // Check permission before creating the sensor
  const permApi = (navigator as unknown as { permissions?: { query(o: { name: string }): Promise<{ state: string }> } }).permissions;
  if (permApi) {
    const status = await permApi.query({ name: 'magnetometer' }).catch(() => null);
    if (status?.state === 'denied') {
      onFinding({
        module: 'magnetic', severity: 'info',
        title: 'Permiso de magnetómetro denegado',
        detail: 'Ve a Ajustes del sitio en tu navegador y permite el acceso a los sensores de movimiento.',
        evidence: { source: 'Permissions API', state: 'denied' },
      });
      return () => {};
    }
  }

  let sensor: ReturnType<NonNullable<typeof w.Magnetometer>['prototype']['constructor']> | null = null;

  try {
    sensor = new w.Magnetometer({ frequency: 10 });
  } catch {
    onFinding({
      module: 'magnetic', severity: 'info',
      title: 'No se pudo iniciar el magnetómetro',
      detail: 'El sistema operativo rechazó la creación del sensor. En Android, asegúrate de que Chrome tenga permisos de sensores.',
      evidence: { source: 'Magnetometer API', result: 'constructor-error' },
    });
    return () => {};
  }

  const samples: number[] = [];
  let baselineMagnitude: number | null = null;
  let baselineDone = false;
  const startedAt = Date.now();
  let anomalyStreak = 0;
  let anomalyReported = false;

  sensor.addEventListener('reading', () => {
    if (!sensor) return;
    const { x, y, z } = sensor;
    if (x == null || y == null || z == null) return;

    const magnitude = Math.sqrt(x * x + y * y + z * z);

    // ── Phase 1: baseline ─────────────────────────────────────────────────
    const elapsed = Date.now() - startedAt;
    const secondsRemaining = Math.max(0, Math.ceil((BASELINE_SAMPLE_MS - elapsed) / 1000));

    if (!baselineDone) {
      samples.push(magnitude);
      onProgress?.({
        phase: 'baseline',
        currentMicroTesla: Number(magnitude.toFixed(1)),
        baselineMicroTesla: null,
        signedDelta: null,
        secondsRemaining,
      });

      if (elapsed >= BASELINE_SAMPLE_MS) {
        baselineDone = true;
        baselineMagnitude = samples.reduce((a, b) => a + b, 0) / samples.length;
        onFinding({
          module: 'magnetic', severity: 'info',
          title: `Campo magnético base calibrado: ${baselineMagnitude.toFixed(1)} µT`,
          detail: 'Línea base establecida. Ahora mueve el teléfono lentamente cerca de enchufes, marcos de cuadros, detectores de humo y repisas. Un incremento sostenido de más de 25 µT puede indicar electrónica oculta.',
          evidence: { baselineMicroTesla: Number(baselineMagnitude.toFixed(2)), samples: samples.length, source: 'Magnetometer API' },
        });
      }
      return;
    }

    // ── Phase 2: monitoring ───────────────────────────────────────────────
    if (baselineMagnitude == null) return;

    // SIGNED delta: hidden devices ADD field, they don't reduce it.
    const signedDelta = magnitude - baselineMagnitude;
    const isAnomaly = signedDelta > ANOMALY_DELTA_UT;

    // Always report live progress
    onProgress?.({
      phase: 'monitoring',
      currentMicroTesla: Number(magnitude.toFixed(1)),
      baselineMicroTesla: Number(baselineMagnitude.toFixed(1)),
      signedDelta: Number(signedDelta.toFixed(1)),
      secondsRemaining: 0,
    });

    if (isAnomaly) {
      anomalyStreak++;
      // Drift very slowly during anomaly so baseline doesn't absorb the source
      baselineMagnitude = baselineMagnitude * (1 - BASELINE_DRIFT_ACTIVE) + magnitude * BASELINE_DRIFT_ACTIVE;
    } else {
      // Fast drift in calm zone — corrects for moving to a different ambient area
      baselineMagnitude = baselineMagnitude * (1 - BASELINE_DRIFT_CALM) + magnitude * BASELINE_DRIFT_CALM;
      anomalyStreak = 0;
    }

    if (anomalyStreak >= ANOMALY_CONFIRM_COUNT && !anomalyReported) {
      anomalyReported = true;
      onFinding({
        module: 'magnetic', severity: 'suspicious',
        title: `Anomalía magnética: +${signedDelta.toFixed(1)} µT sobre la base`,
        detail: `El campo magnético aumentó ${signedDelta.toFixed(1)} µT por encima de la línea base durante ${anomalyStreak} lecturas consecutivas (~${(anomalyStreak * 100).toFixed(0)} ms). Este patrón es compatible con un componente electrónico o magnético cercano (transformador, bobina de carga, motor de cámara). Para localizar la fuente: aléjate lentamente; si el campo baja de vuelta, la fuente está en esa dirección.`,
        evidence: {
          magnitude: Number(magnitude.toFixed(2)),
          baseline: Number(baselineMagnitude.toFixed(2)),
          signedDelta: Number(signedDelta.toFixed(2)),
          streak: anomalyStreak,
          source: 'Magnetometer API',
        },
      });
    }

    if (anomalyStreak === 0 && anomalyReported) {
      anomalyReported = false;
    }
  });

  sensor.addEventListener('error', (e: unknown) => {
    onFinding({
      module: 'magnetic', severity: 'info',
      title: 'Error al leer el sensor magnético',
      detail: 'El sistema interrumpió la lectura del sensor. Puede ser un problema de permisos o de hardware.',
      evidence: { source: 'Magnetometer API', result: 'read-error', error: String(e) },
    });
  });

  sensor.start();
  return () => { try { sensor?.stop(); } catch { /* ignore */ } };
}
