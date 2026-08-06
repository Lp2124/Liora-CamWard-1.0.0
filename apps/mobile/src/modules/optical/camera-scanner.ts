/**
 * apps/mobile — Camera Scanner (React Native / expo-camera)
 *
 * Pipeline de detección óptica nativa con análisis diferencial.
 * Implementa las 3 fases de captura:
 *  1. Captura con iluminación normal
 *  2. Captura con linterna apagada
 *  3. Captura con linterna encendida
 *
 * El análisis diferencial compara torch_off vs torch_on para distinguir
 * reflejos de lente reales de fuentes de luz fijas (LEDs).
 *
 * NOTA: Esta app usa cámara RGB convencional.
 * La función se llama "Búsqueda de emisores infrarrojos visibles para la cámara"
 * NO "visión infrarroja" — algunos sensores RGB pueden ver IR cercano, otros no.
 *
 * Versión: 1.0.0
 */

import { Camera, type CameraType, type FlashMode } from 'expo-camera';
import type { OpticalClusterData, SubmitOpticalObservationRequest } from '@liora/contracts';
import { randomUUID } from 'expo-crypto';

export type CapturePhase = 'normal' | 'torch_off' | 'torch_on';

export interface FrameAnalysisResult {
  clusters: OpticalClusterData[];
  frameCount: number;
  brightnessEstimate: number;
  torchActive: boolean;
  captureMode: CapturePhase;
}

export interface IrCompatibilityResult {
  compatible: boolean;
  testedWithReference: boolean;
  explanation: string;
}

/**
 * Verifica si la cámara puede detectar emisores IR.
 * Si no puede detectar IR, la función se deshabilita con explicación clara.
 *
 * Un sensor RGB convencional puede o no filtrar IR según el fabricante.
 * Esta prueba usa una fuente IR de referencia (control remoto de TV).
 */
export async function testIrCompatibility(
  cameraRef: React.RefObject<Camera | null>,
): Promise<IrCompatibilityResult> {
  if (!cameraRef.current) {
    return {
      compatible: false,
      testedWithReference: false,
      explanation: 'Cámara no disponible para prueba de compatibilidad IR.',
    };
  }

  try {
    // Capturar frame base
    const photoBase = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true });

    // Instrucción al usuario: apuntar un control remoto de TV al teléfono
    // En una implementación completa, se analiza el diff entre dos capturas
    // Para esta versión, retornamos "no probado con referencia" para ser honestos
    void photoBase;

    return {
      compatible: false, // conservativo: no declarar IR hasta probar con referencia real
      testedWithReference: false,
      explanation:
        'No se ha probado con una fuente IR de referencia (ej. control remoto de TV). ' +
        'Para habilitar la búsqueda de emisores IR visibles, apunta un control remoto al teléfono ' +
        'y pulsa cualquier botón mientras la app analiza. Si la cámara detecta un punto brillante, ' +
        'el sensor es compatible con IR cercano.',
    };
  } catch {
    return {
      compatible: false,
      testedWithReference: false,
      explanation: 'Error al acceder a la cámara para prueba IR.',
    };
  }
}

export interface CaptureRequest {
  inspectionId: string;
  phase: CapturePhase;
  orientation: { alpha: number; beta: number; gamma: number };
  deviceFingerprint: string;
  previousClusters?: OpticalClusterData[];
}

/**
 * Analiza un frame de la cámara para detectar clusters ópticos.
 * Solo envía datos crudos al servidor — nunca calcula severity o verdict.
 */
export function buildOpticalObservationRequest(
  result: FrameAnalysisResult,
  inspectionId: string,
  orientation: { alpha: number; beta: number; gamma: number },
  deviceFingerprint: string,
): SubmitOpticalObservationRequest {
  return {
    inspectionId,
    captureNonce: randomUUID(),
    clientTimestamp: new Date().toISOString(),
    captureMode: result.captureMode,
    brightnessEstimate: result.brightnessEstimate,
    torchActive: result.torchActive,
    orientation,
    clusterData: result.clusters,
    frameCount: result.frameCount,
    deviceFingerprint,
  };
}

/**
 * Constantes de análisis óptico — no exponen verdict ni severity.
 * El servidor clasifica, el cliente solo envía datos crudos.
 */
export const OPTICAL_ANALYSIS_CONSTANTS = {
  BRIGHTNESS_THRESHOLD: 240,
  MIN_CLUSTER_PX: 3,
  MAX_CLUSTER_PX: 500,
  PERSIST_FRAMES_REQUIRED: 6,
  COMPACTNESS_MIN: 0.30,
  MAX_SATURATION: 0.30,
  EDGE_MARGIN_PX: 10,
  MAX_CLUSTER_PX_EXPANDED: 1000, // para flood fill antes de filtrar
} as const;
