import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0a0a' },
          headerTintColor: '#00ff88',
          headerTitleStyle: { fontWeight: 'bold', color: '#ffffff' },
          contentStyle: { backgroundColor: '#0a0a0a' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Liora CamWard', headerShown: false }} />
        <Stack.Screen name="scan" options={{ title: 'Escaneo activo' }} />
        <Stack.Screen name="history" options={{ title: 'Historial' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
