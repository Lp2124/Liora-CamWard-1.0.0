import { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BleDeviceObservation } from '@liora/contracts';
import { scanBleWindow } from '../src/modules/ble/ble-scanner';

export default function BleInspectionScreen() {
  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState<BleDeviceObservation[]>([]);
  const [status, setStatus] = useState('Listo para explorar Bluetooth.');

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setDevices([]);
    setStatus('Explorando Bluetooth...');

    const latest = new Map<string, BleDeviceObservation>();

    try {
      const result = await scanBleWindow(12000, (device) => {
        latest.set(device.anonymizedId, device);
        setDevices(Array.from(latest.values()));
      });

      if (result.permissionStatus !== 'granted') {
        setStatus(`Permiso Bluetooth: ${result.permissionStatus}.`);
      } else if (result.bluetoothState !== 'PoweredOn') {
        setStatus(`Bluetooth no disponible: ${result.bluetoothState}.`);
      } else {
        setDevices(result.devices);
        setStatus(`Exploración terminada: ${result.devices.length} dispositivos observados en ${Math.round(result.scanDurationMs / 1000)} s.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error de exploración Bluetooth.');
    } finally {
      setRunning(false);
    }
  }, [running]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Exploración Bluetooth</Text>
        <Text style={styles.subtitle}>Escaneo BLE real del hardware cercano. Un dispositivo BLE no equivale a una cámara.</Text>
      </View>

      <Text style={styles.status}>{status}</Text>

      <FlatList
        data={devices}
        keyExtractor={(item) => item.anonymizedId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Sin observaciones BLE todavía.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name ?? 'Dispositivo sin nombre'}</Text>
            <Text style={styles.detail}>ID de sesión: {item.anonymizedId}</Text>
            <Text style={styles.detail}>RSSI medio: {item.rssi ?? 'N/D'} dBm</Text>
            <Text style={styles.detail}>Observaciones: {item.occurrenceCount}</Text>
            <Text style={styles.detail}>Conectable: {item.connectability == null ? 'N/D' : item.connectability ? 'Sí' : 'No'}</Text>
          </View>
        )}
      />

      <View style={styles.controls}>
        <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={start} disabled={running}>
          <Text style={styles.buttonText}>{running ? 'Explorando…' : 'Iniciar exploración BLE'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { padding: 20, paddingBottom: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#888', fontSize: 12, lineHeight: 18, marginTop: 6 },
  status: { color: '#aaa', paddingHorizontal: 20, paddingBottom: 12, fontSize: 13 },
  list: { padding: 16, paddingBottom: 120 },
  empty: { color: '#555', textAlign: 'center', marginTop: 32 },
  card: { backgroundColor: '#111', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#202020' },
  name: { color: '#fff', fontWeight: '700', marginBottom: 6 },
  detail: { color: '#777', fontSize: 12, marginTop: 2 },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: '#0a0a0a' },
  button: { backgroundColor: '#00ff88', padding: 17, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#07110c', fontWeight: '800', fontSize: 15 },
});