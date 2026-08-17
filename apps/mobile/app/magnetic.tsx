import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  startMagneticScanNative,
  type MagneticNativeProgress,
  type MagneticScanHandle,
} from '../src/modules/magnetic/magnetometer-native';

export default function MagneticInspectionScreen() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MagneticNativeProgress | null>(null);
  const handleRef = useRef<MagneticScanHandle | null>(null);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    if (running) return;
    setProgress(null);
    setRunning(true);

    try {
      const handle = await startMagneticScanNative((next) => {
        setProgress(next);
        if (next.phase === 'unavailable' || next.phase === 'error') {
          handleRef.current?.stop();
          handleRef.current = null;
          setRunning(false);
        }
      });
      handleRef.current = handle;
    } catch {
      setRunning(false);
      setProgress(null);
    }
  }, [running]);

  const phaseLabel = progress?.phase === 'calibrating'
    ? `Calibrando (${progress.secondsRemainingCalibration}s)`
    : progress?.phase === 'monitoring'
      ? 'Monitoreando'
      : progress?.phase === 'unavailable'
        ? 'Sensor no disponible'
        : progress?.phase === 'error'
          ? 'Lectura inválida o saturada'
          : 'Listo';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Detección Magnética</Text>
        <Text style={styles.subtitle}>Lectura física del magnetómetro. Es evidencia secundaria y por sí sola no confirma una cámara.</Text>
      </View>

      <View style={styles.panel}>
        <Metric label="Estado" value={phaseLabel} />
        <Metric label="Campo actual" value={progress ? `${progress.currentMicroTesla.toFixed(1)} µT` : 'N/D'} />
        <Metric label="Baseline" value={progress?.baselineMicroTesla == null ? 'N/D' : `${progress.baselineMicroTesla.toFixed(1)} µT`} />
        <Metric label="Delta" value={progress?.signedDelta == null ? 'N/D' : `${progress.signedDelta.toFixed(1)} µT`} />
        <Metric label="MAD" value={progress?.mad == null ? 'N/D' : progress.mad.toFixed(2)} />
        <Metric label="Umbral adaptativo" value={progress?.adaptiveThreshold == null ? 'N/D' : `${progress.adaptiveThreshold.toFixed(1)} µT`} />
        <Metric label="Calidad" value={progress ? `${Math.round(progress.signalQuality * 100)}%` : 'N/D'} />
        <Metric label="Muestras" value={progress ? String(progress.samples.length) : '0'} />
      </View>

      <View style={styles.controls}>
        {running ? (
          <TouchableOpacity style={styles.stopButton} onPress={stop}>
            <Text style={styles.stopText}>Detener lectura</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.startButton} onPress={start}>
            <Text style={styles.startText}>Iniciar lectura magnética</Text>
          </TouchableOpacity>
        )}
      </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { padding: 20 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#888', fontSize: 12, lineHeight: 18, marginTop: 6 },
  panel: { margin: 16, backgroundColor: '#111', borderRadius: 12, paddingHorizontal: 16 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#202020' },
  metricLabel: { color: '#777', fontSize: 13 },
  metricValue: { color: '#ddd', fontSize: 13, fontWeight: '600' },
  controls: { marginTop: 'auto', padding: 16 },
  startButton: { backgroundColor: '#00ff88', borderRadius: 12, padding: 17, alignItems: 'center' },
  startText: { color: '#07110c', fontWeight: '800', fontSize: 15 },
  stopButton: { backgroundColor: '#260707', borderRadius: 12, padding: 17, alignItems: 'center', borderWidth: 1, borderColor: '#ff4444' },
  stopText: { color: '#ff6666', fontWeight: '800', fontSize: 15 },
});