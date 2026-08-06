/**
 * apps/mobile — Home Screen
 *
 * Pantalla de inicio de Liora CamWard.
 * Describe con honestidad las capacidades y limitaciones.
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
          <Text style={styles.subtitle}>Asistente de detección de anomalías</Text>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>⚠️ Información importante</Text>
          <Text style={styles.disclaimerText}>
            LIORA CAMWARD ayuda a identificar señales y anomalías que pueden requerir
            inspección adicional. Ningún análisis basado únicamente en un teléfono puede
            descartar todos los dispositivos ocultos.
          </Text>
          <Text style={styles.disclaimerText}>
            Los resultados son indicativos, no concluyentes. Siempre verifica visualmente
            cualquier hallazgo.
          </Text>
        </View>

        <View style={styles.modules}>
          <Text style={styles.modulesTitle}>Módulos de detección</Text>
          <ModuleRow icon="📷" title="Óptico" description="Búsqueda de reflejos de lente con análisis diferencial" />
          <ModuleRow icon="🧲" title="Magnético" description="Detección de fuentes magnéticas anómalas (evidencia secundaria)" />
          <ModuleRow icon="📡" title="Bluetooth" description="Escaneo real BLE con base de firmas versionada" />
          <ModuleRow icon="🌐" title="Red" description="Detección mDNS/SSDP/ONVIF donde el SO lo permita" />
        </View>

        <TouchableOpacity
          style={styles.startButton}
          onPress={() => router.push('/scan')}
          accessibilityLabel="Iniciar escaneo"
          accessibilityRole="button"
        >
          <Text style={styles.startButtonText}>Iniciar escaneo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.historyButton}
          onPress={() => router.push('/history')}
          accessibilityLabel="Ver historial"
          accessibilityRole="button"
        >
          <Text style={styles.historyButtonText}>Historial de inspecciones</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ModuleRow({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <View style={styles.moduleRow}>
      <Text style={styles.moduleIcon}>{icon}</Text>
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
  moduleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  moduleIcon: { fontSize: 20, marginRight: 12, marginTop: 2 },
  moduleInfo: { flex: 1 },
  moduleTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  moduleDesc: { fontSize: 12, color: '#666', marginTop: 2, lineHeight: 18 },
  startButton: {
    backgroundColor: '#00ff88',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  startButtonText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1 },
  historyButton: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  historyButtonText: { fontSize: 14, color: '#666' },
});
