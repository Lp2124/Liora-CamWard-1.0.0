/**
 * Liora CamWard — mobile scan screen.
 *
 * This screen coordinates real native sensors. It does not fabricate optical
 * findings: camera preview is active, while optical classification remains
 * disabled until a real pixel-analysis pipeline is wired.
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
import { CameraView, useCameraPermissions } from 'expo-camera';
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
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
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
      setError('No se pudo crear la inspección. Verifica tu conexión.');
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

        magneticIntervalRef.current = setInterval(async () => {
          const progress = latestMagneticProgressRef.current;
          if (!progress || progress.phase !== 'monitoring' || magneticSubmittedRef.current) {
            return;
          }

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
              orientation: { alpha: 0, beta: 0, gamma: 0 },
              deviceFingerprint: DEVICE_FINGERPRINT,
            });
            addFindings(result.findings, result.riskContribution);
          } catch {
            setError('No se pudo enviar la lectura magnética; los demás módulos continúan.');
          } finally {
            markModuleComplete('magnetic');
          }
        }, 500);
      })
      .catch(() => {
        markModuleComplete('magnetic');
      });

    let bleSeenCount = 0;
    scanBleWindow(12000, () => {
      bleSeenCount += 1;
      setBleDevicesFound(bleSeenCount);
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
            setError('No se pudo enviar el escaneo Bluetooth; la captura local sí se realizó.');
          }
        }
        markModuleComplete('ble');
      })
      .catch(() => {
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

  if (!cameraPermission) return <View style={styles.container} />;

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.permText}>Se requiere acceso a la cámara</Text>
          <Text style={styles.permSubtext}>
            Liora CamWard usa la cámara para inspección óptica. No declara hallazgos ópticos
            hasta que el análisis real de imagen haya sido ejecutado.
          </Text>
          <TouchableOpacity style={styles.permButton} onPress={requestCameraPermission}>
            <Text style={styles.permButtonText}>Conceder permiso</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          enableTorch={phase === 'scanning'}
        />
        {phase === 'scanning' && (
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraHint}>Mueve lentamente por la habitación</Text>
          </View>
        )}
      </View>

      <View style={[styles.riskBanner, { borderColor: riskColor }]}>
        <Text style={[styles.riskLabel, { color: riskColor }]}>
          {riskResult ? getRiskLabel(riskResult.level) : 'Sin clasificación todavía'}
        </Text>
        {riskResult && <Text style={styles.riskScore}>Score: {riskResult.score}/100</Text>}
      </View>

      <ScrollView style={styles.modules} contentContainerStyle={styles.modulesContent}>
        <ModuleStatus
          label="Magnetómetro"
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
          label="Bluetooth"
          status={bleDevicesFound > 0 ? `${bleDevicesFound} observaciones BLE` : phase === 'scanning' ? 'Escaneando...' : 'Inactivo'}
        />
        <ModuleStatus
          label="Óptico"
          status={phase === 'scanning' ? 'Cámara activa; clasificación óptica no habilitada' : 'Inactivo'}
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
            <Text style={styles.scanButtonText}>
              {phase === 'idle' ? 'Iniciar inspección' : 'Nueva inspección'}
            </Text>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  cameraContainer: { height: 220, backgroundColor: '#111' },
  camera: { flex: 1 },
  cameraOverlay: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  cameraHint: { color: '#00ff88', fontSize: 12, opacity: 0.8 },
  riskBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  riskLabel: { fontSize: 14, fontWeight: '700' },
  riskScore: { fontSize: 12, color: '#666' },
  modules: { flex: 1 },
  modulesContent: { padding: 16 },
  moduleStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  moduleLabel: { fontSize: 13, color: '#666' },
  moduleValue: { fontSize: 13, color: '#aaa', maxWidth: '70%', textAlign: 'right' },
  errorBox: {
    backgroundColor: '#1a0000',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#ff0044',
  },
  errorText: { color: '#ff4444', fontSize: 12 },
  findings: { marginTop: 16 },
  findingsTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 12 },
  finding: {
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
  },
  findingTitle: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 4 },
  findingDetail: { fontSize: 11, color: '#888', lineHeight: 16 },
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
  stopButtonText: { fontSize: 16, fontWeight: '700', color: '#ff4444' },
  permText: { fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 12 },
  permSubtext: { fontSize: 13, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  permButton: { backgroundColor: '#00ff88', borderRadius: 10, padding: 16, alignItems: 'center' },
  permButtonText: { fontSize: 14, fontWeight: '700', color: '#0a0a0a' },
});