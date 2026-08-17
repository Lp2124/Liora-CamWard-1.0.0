import type { Finding, ModuleAvailability } from './types';

// Common local-network ranges where consumer IP cameras/NVRs sit alongside
// routers (192.168.0.0/24, 192.168.1.0/24, 10.0.0.0/24 etc.).

export function networkAvailability(): ModuleAvailability {
  // navigator.onLine is defined (even as false) in all browser contexts;
  // the previous !!navigator.onLine !== undefined was always true because
  // booleans never equal undefined. The correct check is just typeof navigator.
  const supported = typeof navigator !== 'undefined' && typeof navigator.onLine !== 'undefined';
  return { module: 'network', supported, permissionState: 'granted' };
}

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  type?: string;
}

/**
 * Real, browser-safe network reconnaissance. A browser sandbox cannot open
 * raw TCP sockets or perform a LAN port scan, so this module does not claim
 * to provide that capability.
 *
 * What IS real and useful:
 *  - WebRTC local ICE candidates, which reveal the device's actual subnet.
 *    We only report this as a *context note* (severity: 'info', no risk bump),
 *    NOT as evidence of a camera. Being on a private LAN is true for every
 *    home/hotel/office network, so it must never trigger a risk alert.
 *  - Connection type (WiFi vs cellular). If the user is on cellular they
 *    cannot be on the same LAN as a hidden camera — that IS a useful signal.
 *
 * Nothing is fabricated. This module intentionally produces zero suspicious /
 * high findings on its own; those only come from Bluetooth name matching,
 * optical lens-glint, or magnetic anomaly.
 */
export async function scanNetworkOnce(onFinding: (finding: Finding) => void): Promise<void> {
  const nav = navigator as Navigator & { connection?: NetworkInformationLike };
  const conn = nav.connection;

  // Only surface a network-type note when we know the connection type.
  // "unknown" or missing → skip entirely (no point cluttering the report).
  if (conn?.type && conn.type !== 'unknown') {
    const onWifi = conn.type === 'wifi';
    onFinding({
      module: 'network',
      severity: 'info',
      title: onWifi ? 'Conectado por WiFi' : `Tipo de red: ${conn.type}`,
      detail: onWifi
        ? 'Estás en WiFi. Las cámaras IP locales solo son accesibles desde la misma red WiFi. Complementa el escaneo con Bluetooth y la cámara del teléfono.'
        : 'No estás en WiFi. Las cámaras IP domésticas necesitan estar en la misma red local, así que este vector es menos relevante ahora.',
      evidence: { type: conn.type, effectiveType: conn.effectiveType ?? null, source: 'Network Information API' },
    });
  }
  // Note: we deliberately do NOT report local IP or subnet as a finding.
  // "You are on 192.168.x" is true for every private network and gives zero
  // signal about hidden cameras. Reporting it inflates the finding list and
  // misleads users. Removed.
}
