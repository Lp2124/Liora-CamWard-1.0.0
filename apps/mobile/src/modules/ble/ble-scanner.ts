/**
 * Liora CamWard — real native BLE scanner.
 *
 * Uses react-native-ble-plx for an actual scan window. Native device identifiers
 * are never returned or persisted; each observed native identifier is mapped to
 * a random identifier that exists only for the current scan session.
 */
import { BleManager, type Device, State } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { randomUUID } from 'expo-crypto';
import type { BleDeviceObservation } from '@liora/contracts';

export type BlePermissionStatus = 'granted' | 'denied' | 'unavailable' | 'bluetooth_off';

export interface BleScanResult {
  devices: BleDeviceObservation[];
  scanDurationMs: number;
  permissionStatus: BlePermissionStatus;
  bluetoothState: string;
}

let manager: BleManager | null = null;

function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

export async function requestBlePermissions(): Promise<BlePermissionStatus> {
  if (Platform.OS === 'ios') {
    const result = await request(PERMISSIONS.IOS.BLUETOOTH);
    if (result === RESULTS.GRANTED) return 'granted';
    if (result === RESULTS.UNAVAILABLE) return 'unavailable';
    return 'denied';
  }

  if (Platform.OS === 'android') {
    const apiLevel = Platform.Version as number;
    if (apiLevel >= 31) {
      const [scanResult, connectResult] = await Promise.all([
        request(PERMISSIONS.ANDROID.BLUETOOTH_SCAN),
        request(PERMISSIONS.ANDROID.BLUETOOTH_CONNECT),
      ]);
      return scanResult === RESULTS.GRANTED && connectResult === RESULTS.GRANTED
        ? 'granted'
        : 'denied';
    }

    const locationResult = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
    return locationResult === RESULTS.GRANTED ? 'granted' : 'denied';
  }

  return 'unavailable';
}

export async function checkBluetoothState(): Promise<State> {
  return getManager().state();
}

export async function scanBleWindow(
  windowMs = 12000,
  onDevice?: (device: BleDeviceObservation) => void,
): Promise<BleScanResult> {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('BLE_SCAN_WINDOW_INVALID');
  }

  const permissionStatus = await requestBlePermissions();
  if (permissionStatus !== 'granted') {
    return {
      devices: [],
      scanDurationMs: 0,
      permissionStatus,
      bluetoothState: 'Unknown',
    };
  }

  const bluetoothState = await checkBluetoothState();
  if (bluetoothState !== State.PoweredOn) {
    return {
      devices: [],
      scanDurationMs: 0,
      permissionStatus: 'granted',
      bluetoothState,
    };
  }

  const sessionIds = new Map<string, string>();
  const seenDevices = new Map<string, {
    observation: BleDeviceObservation;
    rssiHistory: number[];
    firstSeenMs: number;
  }>();

  const startMs = Date.now();

  await new Promise<void>((resolve) => {
    getManager().startDeviceScan(
      null,
      { allowDuplicates: true },
      (error, device) => {
        if (error || !device) return;

        const now = Date.now();
        let sessionId = sessionIds.get(device.id);
        if (!sessionId) {
          sessionId = `ble_${randomUUID()}`;
          sessionIds.set(device.id, sessionId);
        }

        const existing = seenDevices.get(sessionId);
        if (existing) {
          if (device.rssi != null) {
            existing.rssiHistory.push(device.rssi);
            if (existing.rssiHistory.length > 20) existing.rssiHistory.shift();
          }
          existing.observation = buildObservation(
            device,
            sessionId,
            existing.rssiHistory,
            existing.firstSeenMs,
            now,
          );
          onDevice?.(existing.observation);
          return;
        }

        const rssiHistory = device.rssi == null ? [] : [device.rssi];
        const observation = buildObservation(device, sessionId, rssiHistory, now, now);
        seenDevices.set(sessionId, {
          observation,
          rssiHistory,
          firstSeenMs: now,
        });
        onDevice?.(observation);
      },
    );

    setTimeout(() => {
      getManager().stopDeviceScan();
      resolve();
    }, windowMs);
  });

  return {
    devices: Array.from(seenDevices.values()).map(({ observation }) => observation),
    scanDurationMs: Date.now() - startMs,
    permissionStatus: 'granted',
    bluetoothState,
  };
}

function buildObservation(
  device: Device,
  sessionId: string,
  rssiHistory: number[],
  firstSeenMs: number,
  lastSeenMs: number,
): BleDeviceObservation {
  const averageRssi = rssiHistory.length === 0
    ? undefined
    : rssiHistory.reduce((sum, value) => sum + value, 0) / rssiHistory.length;

  return {
    anonymizedId: sessionId,
    name: device.name ?? device.localName ?? null,
    rssi: averageRssi == null ? undefined : Math.round(averageRssi),
    manufacturerDataHex: device.manufacturerData ?? undefined,
    serviceUuids: device.serviceUUIDs ?? undefined,
    connectability: device.isConnectable ?? undefined,
    firstSeenTs: firstSeenMs,
    lastSeenTs: lastSeenMs,
    occurrenceCount: Math.max(1, rssiHistory.length),
  };
}

export function destroyBleManager(): void {
  manager?.destroy();
  manager = null;
}
