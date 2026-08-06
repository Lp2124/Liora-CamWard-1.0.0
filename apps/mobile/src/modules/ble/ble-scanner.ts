/**
 * apps/mobile — BLE Scanner (React Native / real native BLE)
 *
 * Usa react-native-ble-plx para escaneo real continuo — NO requestDevice().
 * requestDevice() solo muestra un diálogo modal — no es escaneo general.
 *
 * Implementa:
 *  - Permisos correctos por versión Android (BLUETOOTH_SCAN desde API 31+)
 *  - Permisos iOS
 *  - Manejo de Bluetooth desactivado
 *  - Escaneo por ventanas
 *  - Deduplicación
 *  - RSSI tracking
 *  - Persistencia y frecuencia de aparición
 *  - Identificador anonimizado (hash del deviceId nativo)
 *
 * Versión: 1.0.0
 */

import { BleManager, type Device, type Subscription, State } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { randomUUID } from 'expo-crypto';
import type { BleDeviceObservation } from '@liora/contracts';

export type BlePermissionStatus =
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'bluetooth_off';

export interface BleScanResult {
  devices: BleDeviceObservation[];
  scanDurationMs: number;
  permissionStatus: BlePermissionStatus;
  bluetoothState: string;
}

// Singleton BleManager
let _manager: BleManager | null = null;

function getManager(): BleManager {
  if (!_manager) _manager = new BleManager();
  return _manager;
}

/** Solicita permisos BLE según versión de Android/iOS */
export async function requestBlePermissions(): Promise<BlePermissionStatus> {
  if (Platform.OS === 'ios') {
    const result = await request(PERMISSIONS.IOS.BLUETOOTH_PERIPHERAL);
    if (result === RESULTS.GRANTED) return 'granted';
    if (result === RESULTS.UNAVAILABLE) return 'unavailable';
    return 'denied';
  }

  if (Platform.OS === 'android') {
    const apiLevel = Platform.Version as number;

    if (apiLevel >= 31) {
      // Android 12+ requiere BLUETOOTH_SCAN + BLUETOOTH_CONNECT
      const [scanResult, connectResult] = await Promise.all([
        request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN),
        request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT),
      ]);
      if (scanResult === RESULTS.GRANTED && connectResult === RESULTS.GRANTED) {
        return 'granted';
      }
      return 'denied';
    } else {
      // Android < 12 requiere ACCESS_FINE_LOCATION para BLE
      const locResult = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
      if (locResult === RESULTS.GRANTED) return 'granted';
      return 'denied';
    }
  }

  return 'unavailable';
}

/** Verifica estado actual de Bluetooth */
export async function checkBluetoothState(): Promise<State> {
  return getManager().state();
}

/**
 * Escaneo BLE real por ventana de tiempo.
 *
 * @param windowMs  Duración del escaneo en ms (recomendado: 10000-15000 ms)
 * @param onDevice  Callback por cada dispositivo nuevo/actualizado
 * @returns  BleScanResult con todos los dispositivos vistos
 */
export async function scanBleWindow(
  windowMs = 12000,
  onDevice?: (device: BleDeviceObservation) => void,
): Promise<BleScanResult> {
  const permStatus = await requestBlePermissions();
  if (permStatus !== 'granted') {
    return { devices: [], scanDurationMs: 0, permissionStatus: permStatus, bluetoothState: 'Unknown' };
  }

  const btState = await checkBluetoothState();
  if (btState !== State.PoweredOn) {
    return { devices: [], scanDurationMs: 0, permissionStatus: 'granted', bluetoothState: btState };
  }

  const seenDevices = new Map<string, {
    obs: BleDeviceObservation;
    rssiHistory: number[];
    firstSeenMs: number;
  }>();

  const startMs = Date.now();
  let subscription: Subscription | null = null;

  await new Promise<void>((resolve) => {
    subscription = getManager().startDeviceScan(
      null,   // sin filtro de service UUIDs — escaneo completo
      { allowDuplicates: true },
      (error, device) => {
        if (error || !device) return;

        const now = Date.now();
        const anonymizedId = anonymizeDeviceId(device.id);
        const existing = seenDevices.get(anonymizedId);

        if (existing) {
          // Actualizar RSSI y conteo
          if (device.rssi != null) {
            existing.rssiHistory.push(device.rssi);
            if (existing.rssiHistory.length > 20) existing.rssiHistory.shift();
          }
          existing.obs = buildObservation(device, existing.rssiHistory, existing.firstSeenMs, now);
          onDevice?.(existing.obs);
        } else {
          const rssiHistory = device.rssi != null ? [device.rssi] : [];
          const obs = buildObservation(device, rssiHistory, now, now);
          seenDevices.set(anonymizedId, { obs, rssiHistory, firstSeenMs: now });
          onDevice?.(obs);
        }
      },
    );

    setTimeout(() => {
      subscription?.remove();
      getManager().stopDeviceScan();
      resolve();
    }, windowMs);
  });

  return {
    devices: Array.from(seenDevices.values()).map((v) => v.obs),
    scanDurationMs: Date.now() - startMs,
    permissionStatus: 'granted',
    bluetoothState: btState,
  };
}

function buildObservation(
  device: Device,
  rssiHistory: number[],
  firstSeenMs: number,
  lastSeenMs: number,
): BleDeviceObservation {
  const avgRssi = rssiHistory.length > 0
    ? rssiHistory.reduce((a, b) => a + b, 0) / rssiHistory.length
    : undefined;

  return {
    anonymizedId: anonymizeDeviceId(device.id),
    name: device.name ?? device.localName ?? null,
    rssi: avgRssi != null ? Math.round(avgRssi) : undefined,
    manufacturerDataHex: device.manufacturerData ?? undefined,
    serviceUuids: device.serviceUUIDs ?? undefined,
    connectability: device.isConnectable ?? undefined,
    firstSeenTs: firstSeenMs,
    lastSeenTs: lastSeenMs,
    occurrenceCount: rssiHistory.length,
  };
}

/**
 * Anonimiza el ID nativo del dispositivo con un hash para no almacenar MACs reales.
 * El anonymizedId es estable dentro de la misma sesión de escaneo.
 */
function anonymizeDeviceId(nativeId: string): string {
  // Usar un hash simple — en prod usar expo-crypto SHA-256
  let hash = 0;
  for (let i = 0; i < nativeId.length; i++) {
    hash = ((hash << 5) - hash) + nativeId.charCodeAt(i);
    hash |= 0;
  }
  return `ble_${Math.abs(hash).toString(36)}`;
}

export function destroyBleManager(): void {
  _manager?.destroy();
  _manager = null;
}
