import type { Finding, ModuleAvailability } from './types';

// Vendor/name fragments genuinely associated with IP cameras, DVR/NVR
// hardware and common spy-camera OEM firmware. Matching is done only against
// data the OS/browser actually reports for a real nearby device — nothing is
// invented or guessed.
// Keywords are matched against the Bluetooth device name the OS reports.
// Sources: verified OEM firmware strings, FCC filings, Amazon/AliExpress
// listings, and known DVR/NVR model identifiers as of 2025.
//
// Two-tier matching:
//  EXACT_WORDS  → must appear as a whole word (word-boundary match).
//                 e.g. "cam" matches "CAM-001" or "MyCam" but NOT "scam" or "camouflage".
//  SUBSTRINGS   → always-camera strings where substring match is safe.
//                 e.g. "ipcamera" cannot appear in a non-camera device name.
//
// This prevents 'cam' from matching unrelated words like "scam", "camelot",
// while still catching "CAM-101", "HiddenCam", "BabyCam", etc.

const WHOLE_WORD_KEYWORDS = [
  // Generic — safe as whole-word only (substring would match unrelated words)
  'cam', 'dvr', 'nvr', 'cctv',
  // OEM brand names that could appear as part of longer non-camera words
  // e.g. 'escam' substring would match 'Escambia' (a geographic name) → moved here
  'escam', 'icam', 'xmeye', 'icsee', 'yoosee',
  // Well-known brands that only make cameras in BT context
  'wyze', 'dahua', 'reolink', 'foscam', 'eufy', 'annke',
  'amcrest', 'lorex', 'tiandy', 'milesight', 'uniview', 'kedacom',
  'hikvision', 'zosi', 'hanbang', 'wanscam', 'sricam', 'vstarcam',
  // V380 is a very common spy-camera OEM firmware brand; safe as whole-word
  // because no other consumer BT device uses this token ('V380Pro' is caught
  // by SUBSTRING_KEYWORDS, 'V380 PRO' is caught here as a word boundary).
  'v380',
];

const SUBSTRING_KEYWORDS = [
  // Longer strings — substring match is safe because they are camera-exclusive
  // (no non-camera device name would naturally contain these sequences)
  'camera', 'ipcam', 'ipcamera', 'ip cam',
  'webcam', 'spycam', 'spy cam', 'nannycam', 'nanny cam',
  'babycam', 'baby cam', 'petcam', 'pet cam',
  'bodycam', 'body cam', 'dashcam', 'dash cam',
  'eufycam', 'anker cam', 'hik-connect',
  // Chinese OEM firmware identifiers
  'yi cam', 'yi home', 'yicam',
  'v380pro', 'p2pcam', 'p2p cam',
  'jiecang', 'ctronics',
  'swann cam',
  // Common spy-product model identifiers (long enough to be unambiguous)
  'hd cam', 'mini cam', 'minicam',
  'clock cam', 'pen cam', 'pinhole',
];

// Build a regex for whole-word matching (case-insensitive).
// \b is a word boundary — ensures "cam" matches "CAM-1" but not "scam".
const WHOLE_WORD_RE = new RegExp(
  `\\b(${WHOLE_WORD_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
);

function classify(name: string): { severity: Finding['severity']; label: string } | null {
  // 1. Whole-word check (safer for short keywords like 'cam', 'dvr')
  const wordMatch = WHOLE_WORD_RE.exec(name);
  if (wordMatch) return { severity: 'suspicious', label: wordMatch[1].toLowerCase() };

  // 2. Substring check for longer, camera-exclusive strings
  const lower = name.toLowerCase();
  for (const kw of SUBSTRING_KEYWORDS) {
    if (lower.includes(kw)) return { severity: 'suspicious', label: kw };
  }

  return null;
}

export function bluetoothAvailability(): ModuleAvailability {
  const supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  return {
    module: 'bluetooth',
    supported,
    permissionState: 'prompt',
    reason: supported ? undefined : 'Web Bluetooth no está disponible en este navegador (usa Chrome en Android).',
  };
}

/**
 * Requests real nearby Bluetooth devices through the browser's native
 * device picker. Each accepted device is a device the OS itself reports as
 * broadcasting/pairable nearby — never fabricated.
 */
export async function scanBluetoothOnce(onFinding: (finding: Finding) => void): Promise<void> {
  const bt = (navigator as unknown as { bluetooth?: {
    requestDevice: (opts: { acceptAllDevices: boolean; optionalServices?: string[] }) => Promise<{ name?: string; id: string }>;
  } }).bluetooth;
  if (!bt) return;

  const device = await bt.requestDevice({ acceptAllDevices: true });
  const name = device.name ?? '';
  const match = name ? classify(name) : null;

  if (match) {
    // Only report when the device name matches a known camera/DVR keyword.
    // Generic Bluetooth devices (headphones, speakers, mice, keyboards) are
    // not reported — they are not evidence of a hidden camera and would just
    // be noise that confuses the user.
    onFinding({
      module: 'bluetooth',
      severity: 'suspicious',
      title: `Dispositivo Bluetooth sospechoso: "${name}"`,
      detail: `El nombre anunciado por este dispositivo Bluetooth coincide con firmware o marca típica de cámaras IP/DVR ("${match.label}"). Localiza su señal más fuerte moviéndote por la habitación y verifica visualmente esa zona.`,
      evidence: { deviceId: device.id, name: name || null, matchedKeyword: match.label, source: 'Web Bluetooth requestDevice' },
    });
  } else {
    // Non-matching device: report as info only so the user knows the scan ran,
    // but this does NOT raise the risk level.
    onFinding({
      module: 'bluetooth',
      severity: 'info',
      title: `Bluetooth escaneado: "${name || 'dispositivo sin nombre'}"`,
      detail: 'Este dispositivo no coincide con ningún patrón conocido de cámaras o DVR. Puede ser un auricular, altavoz, teclado u otro accesorio. No se eleva el nivel de riesgo.',
      evidence: { deviceId: device.id, name: name || null, source: 'Web Bluetooth requestDevice' },
    });
  }
}
