/**
 * apps/mobile — Scan Screen
 *
 * Pantalla de escaneo activo. Coordina todos los módulos.
 * Muestra resultados calculados por el servidor — nunca calcula localmente.
 *
 * Versión: 1.0.0
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Vibration, Alert,
} from 'react-native';
import { Camera, type CameraView } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useScanStore } from '../src/store/scan-store';
import { startMagneticScanNative } from '../src/modules/magnetic/magnetometer-native';
import { scanBleWindow } from '../src/modules/ble/ble-scanner';
import {
  createInspection,
  submitBleObservation,
  submitMagneticObservation,
} from '../src/api/client';
import type { RiskLevel } from '@liora/contracts';

const DEVICE_FINGERPRINT = randomUUID(); // sesión única, no PII

export default function ScanScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = Camera.useCameraPermissions();
  const magneticHandleRef = useRef<{ stop: () => void; getSamples: () => unknown[] } | null>(null);

  const {
    phase, findings, riskResult, magneticProgress, bleDevicesFound,
    error, setPhase, setInspectionId, addFindings, setMagneticProgress,
    setBleDevicesFound, setError, markModuleComplete, reset, inspectionId,
  } = useScanStore();

  // ── Iniciar escaneo ────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    reset();
    setPhase('requesting_permissions');

    // Crear inspección en servidor
    try {
      const inspection = await createInspection({ label: new Date().toLocaleString('es') });
      setInspectionId(inspection.inspectionId);
    } catch {
      setError('No se pudo crear la inspección. Verifica tu conexión.');
      setPhase('error');
      return;
    }

    setPhase('scanning');

    // ── Magnetómetro en paralelo ───────────────────────────────────────────
    startMagneticScanNative((progress) => {
      setMagneticProgress(progress);
    }).then((handle) => {
      magneticHandleRef.current = handle;

      // Después de calibración, enviar muestras al servidor
      const checkCalibrated = setInterval(async () => {
        if (progress?.phase === 'monitoring' && inspectionId) {
          clearInterval(checkCalibrated);
          const samples = handle.getSamples();
          try {
            const result = await submitMagneticObservation({
              inspectionId: inspectionId!,
              captureNonce: randomUUID(),
              clientTimestamp: new Date().toISOString(),
              phase: 'monitoring',
              samples: samples as Parameters<typeof submitMagneticObservation>[0]['samples'],
              orientation: { alpha: 0, beta: 0, gamma: 0 },
              deviceFingerprint: DEVICE_FINGERPRINT,
            });
            addFindings(result.findings, result.riskContribution);
            markModuleComplete('magnetic');
          } catch (e) {
            // Error no fatal — continuar con otros módulos
            markModuleComplete('magnetic');
          }
        }
      }, 1000);
    }).catch(() => {
      markModuleComplete('magnetic');
    });

    // ── BLE en paralelo ───────────────────────────────────────────────────
    scanBleWindow(12000, (device) => {
      setBleDevicesFound((prev) => prev + 1);
      void device; // dispositivos se acumulan
    }).then(async (result) => {
      if (result.devices.length > 0 && inspectionId) {
        try {
          const analysis = await submitBleObservation({
            inspectionId: inspectionId!,
            captureNonce: randomUUID(),
            clientTimestamp: new Date().toISOString(),
            devices: result.devices,
            deviceFingerprint: DEVICE_FINGERPRINT,
          });
          addFindings(analysis.findings, analysis.riskContribution);
        } catch { /* continuar */ }
      }
      markModuleComplete('ble');
    }).catch(() => {
      markModuleComplete('ble');
    });

  }, [reset, setPhase, setInspectionId, addFindings, setMagneticProgress,
    setBleDevicesFound, setError, markModuleComplete, inspectionId]);

  const stopScan = useCallback(() => {
    magneticHandleRef.current?.stop();
    magneticHandleRef.current = null;
    setPhase('completed');
  }, [setPhase]);

  // Vibración en hallazgo importante
  useEffect(() => {
    const lastFinding = findings[findings.length - 1];
    if (lastFinding?.severity === 'suspicious') Vibration.vibrate([200, 100, 200]);
    if (lastFinding?.severity === 'high') Vibration.vibrate([300, 100, 300, 100, 300]);
  }, [findings.length]);

  const riskColor = getRiskColor(riskResult?.level ?? 'none');

  if (!cameraPermission) return <View style={styles.container} />;

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.permText}>Se requiere acceso a la cámara</Text>
          <Text style={styles.permSubtext}>
            Liora CamWard necesita la cámara para analizar reflejos ópticos.
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
      {/* Cámara */}
      <View style={styles.cameraContainer}>
        <Camera
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

      {/* Risk indicator */}
      <View style={[styles.riskBanner, { borderColor: riskColor }]}>
        <Text style={[styles.riskLabel, { color: riskColor }]}>
          {getRiskLabel(riskResult?.level ?? 'none')}
        </Text>
        {riskResult && (
          <Text style={styles.riskScore}>Score: {riskResult.score}/100</Text>
        )}
      </View>

      {/* Módulos */}
      <ScrollView style={styles.modules} contentContainerStyle={{ padding: 16 }}>
        <ModuleStatus
          label="Magnetómetro"
          status={magneticProgress?.phase === 'calibrating'
            ? `Calibrando... ${magneticProgress.secondsRemainingCalibration}s`
            : magneticProgress?.phase === 'monitoring'
              ? `${magneticProgress.currentMicroTesla} µT (Δ${magneticProgress.signedDelta ?? 0} µT)`
              : 'Esperando...'}
        />
        <ModuleStatus
          label="Bluetooth"
          status={bleDevicesFound > 0 ? `${bleDevicesFound} dispositivos vistos` : 'Escaneando...'}
        />
        <ModuleStatus
          label="Óptico"
          status={phase === 'scanning' ? 'Analizando frames...' : 'Inactivo'}
        />

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {findings.length > 0 && (
          <View style={styles.findings}>
            <Text style={styles.findingsTitle}>Hallazgos ({findings.length})</Text>
            {findings.map((f, i) => (
              <View key={f.id ?? i} style={[styles.finding, getSeverityStyle(f.severity)]}>
                <Text style={styles.findingTitle}>{f.title}</Text>
                <Text style={styles.findingDetail} numberOfLines={3}>{f.detail}</Text>
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

      {/* Controls */}
      <View style={styles.controls}>
        {phase === 'idle' || phase === 'completed' || phase === 'error' ? (
          <TouchableOpacity style={styles.scanButton} onPress={startScan}>
            <Text style={styles.scanButtonText}>
              {phase === 'idle' ? 'Iniciar escaneo' : 'Nuevo escaneo'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopScan}>
            <Text style={styles.stopButtonText}>Detener escaneo</Text>
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
    none: '#444',
    informational: '#00aaff',
    low: '#00ff88',
    medium: '#ffaa00',
    high: '#ff4400',
    critical: '#ff0044',
  };
  return colors[level] ?? '#444';
}

function getRiskLabel(level: RiskLevel): string {
  const labels: Record<RiskLevel, string> = {
    none: 'Sin hallazgos',
    informational: 'Informativo',
    low: 'Riesgo bajo',
    medium: 'Riesgo moderado',
    high: 'Riesgo alto',
    critical: 'Riesgo crítico',
  };
  return labels[level] ?? 'Analizando...';
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
  cameraOverlay: {
    position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center',
  },
  cameraHint: { color: '#00ff88', fontSize: 12, opacity: 0.8 },
  riskBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#333',
  },
  riskLabel: { fontSize: 14, fontWeight: '700' },
  riskScore: { fontSize: 12, color: '#666' },
  modules: { flex: 1 },
  moduleStatus: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  moduleLabel: { fontSize: 13, color: '#666' },
  moduleValue: { fontSize: 13, color: '#aaa' },
  errorBox: {
    backgroundColor: '#1a0000', borderRadius: 8, padding: 12, marginTop: 16,
    borderLeftWidth: 3, borderLeftColor: '#ff0044',
  },
  errorText: { color: '#ff4444', fontSize: 12 },
  findings: { marginTop: 16 },
  findingsTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 12 },
  finding: {
    backgroundColor: '#111', borderRadius: 8, padding: 12, marginBottom: 8,
    borderLeftWidth: 3,
  },
  findingTitle: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 4 },
  findingDetail: { fontSize: 11, color: '#888', lineHeight: 16 },
  recommendationBox: {
    backgroundColor: '#0a1a0a', borderRadius: 8, padding: 14, marginTop: 16,
    borderWidth: 1, borderColor: '#00ff8830',
  },
  recommendationLabel: { fontSize: 11, color: '#00ff88', fontWeight: '700', marginBottom: 6 },
  recommendationText: { fontSize: 13, color: '#ccc', lineHeight: 18 },
  controls: { padding: 16, paddingBottom: 24 },
  scanButton: {
    backgroundColor: '#00ff88', borderRadius: 12, padding: 18, alignItems: 'center',
  },
  scanButtonText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  stopButton: {
    backgroundColor: '#1a0000', borderRadius: 12, padding: 18, alignItems: 'center',
    borderWidth: 1, borderColor: '#ff0044',
  },
  stopButtonText: { fontSize: 16, fontWeight: '700', color: '#ff4444' },
  permText: { fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 12 },
  permSubtext: { fontSize: 13, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  permButton: { backgroundColor: '#00ff88', borderRadius: 10, padding: 16, alignItems: 'center' },
  permButtonText: { fontSize: 14, fontWeight: '700', color: '#0a0a0a' },
});
