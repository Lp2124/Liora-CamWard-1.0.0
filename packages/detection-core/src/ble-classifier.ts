/**
 * @liora/detection-core — BleClassifier (SERVER-SIDE)
 *
 * Clasifica dispositivos BLE con los 5 estados requeridos.
 * Un dispositivo BLE NO se clasifica como cámara solo por su nombre.
 *
 * Versión: 1.0.0 — Firma DB versionada
 */

import type { BleDeviceObservation } from '@liora/contracts';

export type BleDeviceClass =
  | 'known_benign'
  | 'unidentified'
  | 'multimedia_compatible'
  | 'requires_inspection'
  | 'persistent_close_signal';

export interface BleClassificationResult {
  deviceClass: BleDeviceClass;
  confidence: number;
  matchedSignature?: string;
  explanation: string;
  signatureDbVersion: string;
}

// ── Base de firmas de cámaras — versionada ────────────────────────────────────
const SIGNATURE_DB_VERSION = '1.0.0';

/**
 * Palabras completas (word-boundary) — seguro para tokens cortos como 'cam'.
 * NO se clasificará un dispositivo como cámara solo por su nombre BLE.
 * Se requiere al menos dos señales independientes.
 */
const WHOLE_WORD_CAMERA_KEYWORDS = [
  'cam', 'dvr', 'nvr', 'cctv', 'escam', 'icam', 'xmeye', 'icsee', 'yoosee',
  'wyze', 'dahua', 'reolink', 'foscam', 'eufy', 'annke', 'amcrest', 'lorex',
  'tiandy', 'milesight', 'uniview', 'kedacom', 'hikvision', 'zosi', 'hanbang',
  'wanscam', 'sricam', 'vstarcam', 'v380',
];

const SUBSTRING_CAMERA_KEYWORDS = [
  'camera', 'ipcam', 'ipcamera', 'ip cam', 'webcam', 'spycam', 'spy cam',
  'nannycam', 'nanny cam', 'babycam', 'baby cam', 'petcam', 'pet cam',
  'bodycam', 'body cam', 'dashcam', 'dash cam', 'eufycam', 'anker cam',
  'hik-connect', 'yi cam', 'yi home', 'yicam', 'v380pro', 'p2pcam', 'p2p cam',
  'jiecang', 'ctronics', 'swann cam', 'hd cam', 'mini cam', 'minicam',
  'clock cam', 'pen cam', 'pinhole',
];

/**
 * Dispositivos benignos conocidos — NUNCA elevar riesgo por estos.
 * Listado explícito para evitar falsos positivos en TV, routers, etc.
 */
const KNOWN_BENIGN_PATTERNS = [
  /^Apple TV/i,
  /^Chromecast/i,
  /^Echo/i,
  /^HomePod/i,
  /^Fire TV/i,
  /^Roku/i,
  /^Xbox/i,
  /^PlayStation/i,
  /^AirPods/i,
  /^Beats/i,
  /^Samsung TV/i,
  /^LG TV/i,
  /^Sony TV/i,
  /^Philips Hue/i,
  /^LIFX/i,
  /^Nest/i,
  /^Ring/i,
  /^Tile/i,
  /^Fitbit/i,
  /^Garmin/i,
];

const WHOLE_WORD_RE = new RegExp(
  `\\b(${WHOLE_WORD_CAMERA_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
);

export function classifyBleDevice(
  device: BleDeviceObservation,
  config?: { minRssiForProximity: number; persistenceMinOccurrences: number },
): BleClassificationResult {
  const cfg = config ?? { minRssiForProximity: -70, persistenceMinOccurrences: 2 };
  const name = device.name ?? '';

  // ── 1. Benigno conocido ───────────────────────────────────────────────────
  if (KNOWN_BENIGN_PATTERNS.some((re) => re.test(name))) {
    return {
      deviceClass: 'known_benign',
      confidence: 0.95,
      matchedSignature: 'known_benign_pattern',
      explanation: `Dispositivo reconocido como benigno: "${name}". No se eleva el riesgo.`,
      signatureDbVersion: SIGNATURE_DB_VERSION,
    };
  }

  // ── 2. Coincidencia con firma de cámara ───────────────────────────────────
  let cameraKeyword: string | undefined;

  if (name) {
    const wordMatch = WHOLE_WORD_RE.exec(name);
    if (wordMatch) cameraKeyword = wordMatch[1].toLowerCase();

    if (!cameraKeyword) {
      const lower = name.toLowerCase();
      cameraKeyword = SUBSTRING_CAMERA_KEYWORDS.find((kw) => lower.includes(kw));
    }
  }

  if (cameraKeyword) {
    // Verificar RSSI y persistencia para graduar la clasificación
    const isClose = device.rssi !== undefined && device.rssi >= cfg.minRssiForProximity;
    const isPersistent = device.occurrenceCount >= cfg.persistenceMinOccurrences;

    const deviceClass: BleDeviceClass =
      isClose && isPersistent ? 'requires_inspection' : 'multimedia_compatible';

    return {
      deviceClass,
      confidence: isClose && isPersistent ? 0.70 : 0.45,
      matchedSignature: cameraKeyword,
      explanation: `Nombre BLE "${name}" coincide con firma de cámara/DVR ("${cameraKeyword}"). ` +
        `RSSI: ${device.rssi ?? 'desconocido'} dBm, apariciones: ${device.occurrenceCount}. ` +
        `Clase: ${deviceClass}. NOTA: nombre BLE alone NO confirma cámara — corrobora visualmente.`,
      signatureDbVersion: SIGNATURE_DB_VERSION,
    };
  }

  // ── 3. Señal persistente y cercana sin nombre conocido ────────────────────
  const isVeryClose = device.rssi !== undefined && device.rssi >= -50;
  const isPersistent = device.occurrenceCount >= cfg.persistenceMinOccurrences;

  if (isVeryClose && isPersistent) {
    return {
      deviceClass: 'persistent_close_signal',
      confidence: 0.30,
      explanation: `Señal BLE sin nombre reconocido, muy cercana (RSSI ${device.rssi} dBm) y persistente (${device.occurrenceCount} apariciones). Podría ser cualquier dispositivo IoT. Verificación visual recomendada.`,
      signatureDbVersion: SIGNATURE_DB_VERSION,
    };
  }

  // ── 4. No identificado ────────────────────────────────────────────────────
  return {
    deviceClass: 'unidentified',
    confidence: 0.0,
    explanation: `Dispositivo "${name || 'sin nombre'}" no coincide con ninguna firma conocida de cámaras ni patrones benignos. No se eleva el riesgo.`,
    signatureDbVersion: SIGNATURE_DB_VERSION,
  };
}
