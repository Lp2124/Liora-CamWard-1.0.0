/**
 * Liora CamWard — Home Screen
 *
 * Production navigation only exposes modules that currently execute real
 * end-to-end work on the device.
 */
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>LIORA CAMWARD</Text>
          <Text style={styles.subtitle}>Asistente de inspección de anomalías</Text>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>Información importante</Text>
          <Text style={styles.disclaimerText}>
            Liora CamWard observa señales disponibles en el teléfono y presenta evidencia
            que puede requerir inspección adicional. Una inspección móvil no puede descartar
            todos los dispositivos ocultos.
          </Text>
          <Text style={styles.disclaimerText}>
            Los resultados describen evidencia observada; no constituyen una afirmación de
            ausencia o presencia definitiva de una cámara.
          </Text>
        </View>

        <View style={styles.modules}>
          <Text style={styles.modulesTitle}>Módulos activos</Text>
          <ModuleRow
            title="Análisis magnético"
            description="Lecturas reales del magnetómetro; evidencia secundaria, nunca confirmación por sí sola."
          />
          <ModuleRow
            title="Exploración Bluetooth"
            description="Escaneo BLE nativo con RSSI y persistencia de observaciones."
          />
        </View>

        <TouchableOpacity
          style={styles.startButton}
          onPress={() => router.push('/scan')}
          accessibilityLabel="Iniciar inspección"
          accessibilityRole="button"
        >
          <Text style={styles.startButtonText}>Iniciar inspección</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ModuleRow({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.moduleRow}>
      <View style={styles.moduleInfo}>
        <Text style={styles.moduleTitle}>{title}</Text>
        <Text style={styles.moduleDesc}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: 32, marginTop: 16 },
  title: { fontSize: 28, fontWeight: '900', color: '#00ff88', letterSpacing: 4 },
  subtitle: { fontSize: 14, color: '#888', marginTop: 8, letterSpacing: 1 },
  disclaimer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 3,
    borderLeftColor: '#ff8800',
  },
  disclaimerTitle: { fontSize: 13, fontWeight: '700', color: '#ff8800', marginBottom: 8 },
  disclaimerText: { fontSize: 13, color: '#aaa', lineHeight: 20, marginBottom: 6 },
  modules: { marginBottom: 32 },
  modulesTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 16 },
  moduleRow: { marginBottom: 16 },
  moduleInfo: { flex: 1 },
  moduleTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  moduleDesc: { fontSize: 12, color: '#777', marginTop: 2, lineHeight: 18 },
  startButton: {
    backgroundColor: '#00ff88',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  startButtonText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1 },
});
