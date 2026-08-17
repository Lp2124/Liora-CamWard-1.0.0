import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createInspection } from '../src/api/client';
import {
  runOpticalInspection,
  type OpticalInspectionProgress,
  type OpticalInspectionResult,
} from '../src/modules/optical/optical-engine';

const DEVICE_FINGERPRINT = randomUUID();

export default function OpticalScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [torchActive, setTorchActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OpticalInspectionProgress | null>(null);
  const [result, setResult] = useState<OpticalInspectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState('Sin iniciar');

  const startInspection = async () => {
    if (!cameraReady || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setBackendStatus('Preparando sesión');

    let inspectionId: string | null = null;
    try {
      const inspection = await createInspection({
        label: `Óptico ${new Date().toLocaleString('es-MX')}`,
      });
      inspectionId = inspection.inspectionId;
      setBackendStatus('Sesión creada');
    } catch {
      setBackendStatus('Backend no disponible; ejecución local');
    }

    try {
      const inspectionResult = await runOpticalInspection({
        cameraRef,
        inspectionId,
        deviceFingerprint: DEVICE_FINGERPRINT,
        setTorchActive,
        onProgress: setProgress,
      });
      setResult(inspectionResult);
      setBackendStatus(
        inspectionResult.syncError
          ? `Local completado; sincronización pendiente: ${inspectionResult.syncError}`
          : `Sincronizado; ${inspectionResult.evidenceUploaded} recortes de evidencia almacenados`,
      );
    } catch (inspectionError) {
      setTorchActive(false);
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : 'La inspección óptica terminó con un error no identificado.',
      );
    } finally {
      setRunning(false);
    }
  };

  if (!permission) {
    return <SafeAreaView style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionBox}>
          <Text style={styles.title}>Análisis Óptico</Text>
          <Text style={styles.body}>
            Este módulo necesita la cámara trasera para capturar series OFF/ON y medir píxeles reales.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Conceder acceso a cámara</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cameraBox}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          enableTorch={torchActive}
          onCameraReady={() => setCameraReady(true)}
        />
        <View style={styles.cameraStatus}>
          <Text style={styles.cameraStatusText}>
            {cameraReady ? (torchActive ? 'TORCH ON' : 'TORCH OFF') : 'Preparando cámara'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Análisis Óptico</Text>
        <Text style={styles.body}>
          Captura 8 frames sin linterna y 8 con linterna. El procesamiento mide brillo, saturación,
          compacidad, persistencia y respuesta diferencial. Un resultado sin candidato persistente
          no descarta otros dispositivos ni zonas fuera de la serie analizada.
        </Text>

        <Metric label="Backend" value={backendStatus} />
        {progress && (
          <>
            <Metric label="Etapa" value={stageLabel(progress.stage)} />
            <Metric label="Frames" value={`${progress.completedFrames}/${progress.totalFrames}`} />
          </>
        )}

        {result && (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>Mediciones de la serie</Text>
            <Metric label="Candidatos persistentes" value={String(result.persistentCandidateCount)} />
            <Metric label="Clusters emparejados OFF/ON" value={String(result.comparison.matchedClusterCount)} />
            <Metric
              label="Delta diferencial"
              value={result.comparison.differentialDelta === null
                ? 'No medido por falta de pareja espacial'
                : result.comparison.differentialDelta.toFixed(2)}
            />
            <Metric label="Brillo medio OFF" value={result.torchOff.brightnessEstimate.toFixed(2)} />
            <Metric label="Brillo medio ON" value={result.torchOn.brightnessEstimate.toFixed(2)} />
            <Metric label="Nitidez ON" value={result.torchOn.sharpnessVariance.toFixed(2)} />
            <Metric label="Sobreexposición ON" value={`${(result.torchOn.overexposedRatio * 100).toFixed(2)}%`} />
            <Metric label="Evidencias almacenadas" value={String(result.evidenceUploaded)} />
            <Metric
              label="Clasificación servidor"
              value={result.serverAnalysis ? verdictLabel(result.serverAnalysis.verdict) : 'No sincronizada'}
            />
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, (!cameraReady || running) && styles.disabledButton]}
          onPress={startInspection}
          disabled={!cameraReady || running}
          accessibilityRole="button"
          accessibilityLabel="Ejecutar análisis óptico"
        >
          {running ? (
            <ActivityIndicator color="#07130d" />
          ) : (
            <Text style={styles.primaryButtonText}>Ejecutar Análisis Óptico</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function stageLabel(stage: OpticalInspectionProgress['stage']): string {
  const labels: Record<OpticalInspectionProgress['stage'], string> = {
    preparing: 'Preparando cámara',
    capturing_torch_off: 'Capturando OFF',
    capturing_torch_on: 'Capturando ON',
    analyzing: 'Agregando mediciones',
    syncing_evidence: 'Sincronizando evidencia',
    syncing_observation: 'Clasificación en servidor',
    completed: 'Completado',
  };
  return labels[stage];
}

function verdictLabel(verdict: string): string {
  const labels: Record<string, string> = {
    clear: 'Sin patrón que alcance criterios en esta serie',
    insufficient_evidence: 'Evidencia insuficiente',
    review_required: 'Requiere revisión',
    suspected_device: 'Patrón óptico sospechoso; requiere corroboración',
    confirmed_device: 'Correlación independiente requerida',
  };
  return labels[verdict] ?? 'Clasificación no reconocida';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080b0a' },
  cameraBox: { height: 280, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraStatus: { position: 'absolute', right: 12, bottom: 12, backgroundColor: '#000b', padding: 8, borderRadius: 8 },
  cameraStatusText: { color: '#8ee8ff', fontSize: 12, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 40 },
  permissionBox: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 10 },
  body: { color: '#a9b3af', fontSize: 13, lineHeight: 19, marginBottom: 18 },
  metric: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#1b2420' },
  metricLabel: { color: '#748079', fontSize: 11, marginBottom: 3 },
  metricValue: { color: '#e6eeea', fontSize: 13 },
  resultBox: { marginTop: 18, padding: 14, borderWidth: 1, borderColor: '#26332d', borderRadius: 10 },
  resultTitle: { color: '#8ee8ff', fontWeight: '800', marginBottom: 8 },
  primaryButton: { marginTop: 20, backgroundColor: '#8ee8ff', padding: 16, borderRadius: 11, alignItems: 'center' },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: '#07130d', fontWeight: '900', fontSize: 14 },
  errorText: { marginTop: 16, color: '#ff6b6b', fontSize: 12 },
});
