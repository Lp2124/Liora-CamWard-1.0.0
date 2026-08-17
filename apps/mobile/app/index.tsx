import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>LIORA CAMWARD</Text>
          <Text style={styles.subtitle}>Inspección modular de señales y anomalías</Text>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>Alcance de los resultados</Text>
          <Text style={styles.disclaimerText}>
            Cada módulo observa únicamente la evidencia que su sensor o interfaz puede medir.
            Ningún módulo, ni la inspección integral, puede afirmar por sí solo que un lugar
            está libre de dispositivos ocultos.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Módulos independientes</Text>

        <ModuleButton
          title="Exploración Bluetooth"
          description="Escaneo BLE nativo, RSSI, persistencia y dispositivos observados."
          route="/ble"
        />

        <ModuleButton
          title="Detección Magnética"
          description="Lectura física del magnetómetro, baseline, delta y calidad de señal."
          route="/magnetic"
        />

        <View style={styles.pendingCard}>
          <Text style={styles.pendingTitle}>Análisis Óptico</Text>
          <Text style={styles.pendingText}>
            Motor separado preservado. No se expone como botón hasta completar análisis real de píxeles y prueba física.
          </Text>
        </View>

        <View style={styles.pendingCard}>
          <Text style={styles.pendingTitle}>Análisis de Red</Text>
          <Text style={styles.pendingText}>
            Motor separado reservado. No se expone como botón hasta implementar descubrimiento real de red en móvil y validarlo en hardware.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Inspección combinada</Text>

        <ModuleButton
          title="Inspección Integral"
          description="Coordinador que reutiliza los motores disponibles sin duplicar su lógica."
          route="/integral"
          primary
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ModuleButton({
  title,
  description,
  route,
  primary = false,
}: {
  title: string;
  description: string;
  route: Href;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.moduleButton, primary && styles.primaryButton]}
      onPress={() => router.push(route)}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={[styles.moduleButtonTitle, primary && styles.primaryTitle]}>{title}</Text>
      <Text style={[styles.moduleButtonDescription, primary && styles.primaryDescription]}>{description}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 20, paddingBottom: 48 },
  header: { alignItems: 'center', marginTop: 14, marginBottom: 24 },
  title: { fontSize: 27, fontWeight: '900', color: '#00ff88', letterSpacing: 3 },
  subtitle: { color: '#888', marginTop: 8, fontSize: 13, textAlign: 'center' },
  disclaimer: { backgroundColor: '#151515', borderRadius: 12, padding: 15, borderLeftWidth: 3, borderLeftColor: '#ff8800', marginBottom: 24 },
  disclaimerTitle: { color: '#ff9f32', fontSize: 13, fontWeight: '800', marginBottom: 7 },
  disclaimerText: { color: '#aaa', fontSize: 12, lineHeight: 18 },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 12, marginTop: 4 },
  moduleButton: { backgroundColor: '#111', borderWidth: 1, borderColor: '#242424', borderRadius: 12, padding: 16, marginBottom: 12 },
  moduleButtonTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  moduleButtonDescription: { color: '#777', fontSize: 12, lineHeight: 18, marginTop: 5 },
  primaryButton: { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  primaryTitle: { color: '#07110c' },
  primaryDescription: { color: '#123322' },
  pendingCard: { borderWidth: 1, borderColor: '#252525', borderRadius: 12, padding: 16, marginBottom: 12 },
  pendingTitle: { color: '#888', fontSize: 15, fontWeight: '800' },
  pendingText: { color: '#5f5f5f', fontSize: 12, lineHeight: 18, marginTop: 5 },
});
