/**
 * Liora CamWard — production mobile inspection screen.
 *
 * Only modules with real device acquisition and server submission are exposed.
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

export default function ScanScreen() {
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

  const stopMagnetic = useCallback(() => {
    clearMagneticInterval();
    magneticHandleRef.current?.stop();
    magneticHandleRef.current = null;
    latestMagneticProgressRef.current = null;
  }, [clearMagneticInterval]);

  const stopNativeResources = useCallback(() => {
    stopMagnetic();
  }, [stopMagnetic]);

  useEffect(() => {
    return () => {
      stopNativeResources();
    };
  }, [stopNativeResources]);

  const startScan = useCallback(async () => {
    stopNativeResources();
    reset();
    setError(null);
    setPhase('requesting_permissions');
    magneticSubmittedRef.current = false;

    let activeInspectionId: string;

    try {
      const inspection = await createInspection({
        label: new Date().toLocaleString('es'),
      });
      activeInspectionId = inspection.inspectionId;
      setInspectionId(activeInspectionId);
    } catch {
      setError('No se pudo crear la inspección. Verifica la conexión y autenticación.');
      setPhase('error');
      return;
    }

    setPhase('scanning');

    startMagneticScanNative((progress) => {
      latestMagneticProgressRef.current = progress;
      setMagneticProgress(progress);
    })
      .then((handle) => {
        magneticHandleRef.current = handle;

        const initialProgress = latestMagneticProgressRef.current;
        if (initialProgress?.phase === 'unavailable' || initialProgress?.phase === 'error') {
          stopMagnetic();
          markModuleComplete('magnetic');
          return;
        }

        magneticIntervalRef.current = setInterval(async () => {
          const progress = latestMagneticProgressRef.current;
          if (!progress || magneticSubmittedRef.current) return;

          if (progress.phase === 'unavailable' || progress.phase === 'error') {
            stopMagnetic();
            markModuleComplete('magnetic');
            return;
          }

          if (progress.phase !== 'monitoring') return;

          const samples = handle.getSamples();
          if (samples.length === 0) return;

          magneticSubmittedRef.current = true;
          clearMagneticInterval();

          try {
            const result = await submitMagneticObservation({
              inspectionId: activeInspectionId,
              captureNonce: randomUUID(),
              clientTimestamp: new Date().toISOString(),
              phase: 'monitoring',
              samples,
              baselineMicroTesla: progress.baselineMicroTesla ?? undefined,
              deviceFingerprint: DEVICE_FINGERPRINT,
            });
            addFindings(result.findings, result.riskContribution);
          } catch {
            setError('La lectura magnética fue capturada, pero el servidor no aceptó la observación.');
          } finally {
            handle.stop();
            magneticHandleRef.current = null;
            markModuleComplete('magnetic');
          }
        }, 500);
      })
      .catch(() => {
        stopMagnetic();
        markModuleComplete('magnetic');
      });

    let bleObservationCount = 0;
    scanBleWindow(12000, () => {
      bleObservationCount += 1;
      setBleDevicesFound(bleObservationCount);
    })
      .then(async (result) => {
        if (result.devices.length > 0) {
          try {
            const analysis = await submitBleObservation({
              inspectionId: activeInspectionId,
              captureNonce: randomUUID(),
              clientTimestamp: new Date().toISOString(),
              devices: result.devices,
              deviceFingerprint: DEVICE_FINGERPRINT,
            });
            addFindings(analysis.findings, analysis.riskContribution);
          } catch {
            setError('El escaneo BLE terminó, pero el servidor no aceptó la observación.');
          }
        }
        markModuleComplete('ble');
      })
      .catch(() => {
        setError('No se pudo ejecutar el escaneo BLE en este dispositivo.');
        markModuleComplete('ble');
      });
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
    stopMagnetic,
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
      <View style={[styles.riskBanner, { borderColor: riskColor }]}>
        <Text style={[styles.riskLabel, { color: riskColor }]}>
          {riskResult ? getRiskLabel(riskResult.level) : 'Sin clasificación todavía'}
        </Text>
        {riskResult && <Text style={styles.riskScore}>Score: {riskResult.score}/100</Text>}
      </View>

      <ScrollView style={styles.modules} contentContainerStyle={styles.modulesContent}>
        <Text style={styles.scopeText}>
          Esta inspección ejecuta únicamente los módulos activos y verificables del dispositivo.
        </Text>

        <ModuleStatus
          label="Análisis magnético"
          status={
            magneticProgress?.phase === 'calibrating'
              ? `Calibrando sensor: ${magneticProgress.secondsRemainingCalibration}s`
              : magneticProgress?.phase === 'monitoring'
                ? `${magneticProgress.currentMicroTesla} µT (Δ${magneticProgress.signedDelta ?? 0} µT)`
                : magneticProgress?.phase === 'unavailable'
                  ? 'Sensor no disponible'
                  : magneticProgress?.phase === 'error'
                    ? 'Lectura inválida o saturada'
                    : phase === 'scanning'
                      ? 'Iniciando sensor...'
                      : 'Inactivo'
          }
        />
        <ModuleStatus
          label="Exploración Bluetooth"
          status={
            bleDevicesFound > 0
              ? `${bleDevicesFound} observaciones BLE recibidas`
              : phase === 'scanning'
                ? 'Escaneando dispositivos...'
                : 'Inactivo'
          }
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
          <TouchableOpacity
            style={styles.scanButton}
            onPress={startScan}
            accessibilityRole="button"
            accessibilityLabel="Iniciar inspección"
          >
            <Text style={styles.scanButtonText}>
              {phase === 'idle' ? 'Iniciar inspección' : 'Nueva inspección'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopScan}
            accessibilityRole="button"
            accessibilityLabel="Detener inspección"
          >
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
    informational: 'Evidencia informativa',
    low: 'Indicadores de riesgo bajo',
    medium: 'Indicadores de riesgo moderado',
    high: 'Indicadores de riesgo alto',
    critical: 'Indicadores críticos',
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
  riskBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  riskLabel: { fontSize: 14, fontWeight: '700', flex: 1 },
  riskScore: { fontSize: 12, color: '#777', marginLeft: 12 },
  modules: { flex: 1 },
  modulesContent: { padding: 16 },
  scopeText: { fontSize: 12, color: '#777', lineHeight: 18, marginBottom: 16 },
  moduleStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  moduleLabel: { fontSize: 13, color: '#888', flex: 1 },
  moduleValue: { fontSize: 13, color: '#bbb', maxWidth: '62%', textAlign: 'right' },
  errorBox: {
    backgroundColor: '#1a0000',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#ff0044',
  },
  errorText: { color: '#ff6666', fontSize: 12, lineHeight: 18 },
  findings: { marginTop: 20 },
  findingsTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 12 },
  finding: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
  },
  findingTitle: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 4 },
  findingDetail: { fontSize: 11, color: '#999', lineHeight: 16 },
  recommendationBox: {
    backgroundColor: '#0a1a0a',
    borderRadius: 8,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#00ff8830',
  },
  recommendationLabel: { fontSize: 11, color: '#00ff88', fontWeight: '700', marginBottom: 6 },
  recommendationText: { fontSize: 13, color: '#ccc', lineHeight: 18 },
  controls: { padding: 16, paddingBottom: 24 },
  scanButton: {
    backgroundColor: '#00ff88',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  scanButtonText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  stopButton: {
    backgroundColor: '#1a0000',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ff0044',
  },
  stopButtonText: { fontSize: 16, fontWeight: '700', color: '#ff6666' },
});
