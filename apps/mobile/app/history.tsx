/**
 * apps/mobile — History Screen
 */
import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listInspections } from '../src/api/client';
import type { InspectionResponse } from '@liora/contracts';

export default function HistoryScreen() {
  const [inspections, setInspections] = useState<InspectionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listInspections()
      .then(setInspections)
      .catch((e) => setError(e.message ?? 'Error al cargar historial'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#00ff88" style={{ marginTop: 32 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {inspections.length === 0 && !error && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No hay inspecciones guardadas aún.</Text>
        </View>
      )}
      <FlatList
        data={inspections}
        keyExtractor={(item) => item.inspectionId}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>{item.label ?? 'Sin etiqueta'}</Text>
              <Text style={[styles.cardRisk, { color: getRiskColor(item.riskResult?.level ?? 'none') }]}>
                {item.riskResult?.level?.toUpperCase() ?? 'N/A'}
              </Text>
            </View>
            <Text style={styles.cardDate}>
              {new Date(item.startedAt).toLocaleString('es')}
            </Text>
            <Text style={styles.cardFindings}>{item.findingCount} hallazgos</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function getRiskColor(level: string): string {
  const map: Record<string, string> = {
    none: '#444', informational: '#00aaff', low: '#00ff88',
    medium: '#ffaa00', high: '#ff4400', critical: '#ff0044',
  };
  return map[level] ?? '#444';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  errorBox: { margin: 16, backgroundColor: '#1a0000', borderRadius: 8, padding: 12 },
  errorText: { color: '#ff4444', fontSize: 13 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#444', fontSize: 14 },
  card: {
    backgroundColor: '#111', borderRadius: 10, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#1a1a1a',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  cardLabel: { fontSize: 14, fontWeight: '600', color: '#fff', flex: 1 },
  cardRisk: { fontSize: 12, fontWeight: '700' },
  cardDate: { fontSize: 11, color: '#555', marginBottom: 4 },
  cardFindings: { fontSize: 12, color: '#666' },
});
