/**
 * @liora/detection-core — DetectionConfig
 *
 * Configuración versionada de todos los umbrales de detección.
 * Las configuraciones remotas deben estar firmadas.
 * La app rechaza configuraciones inválidas o no firmadas.
 *
 * Versión: 1.0.0
 */

export interface DetectionConfig {
  version: string;
  optical: OpticalConfig;
  magnetic: MagneticConfig;
  ble: BleConfig;
  network: NetworkConfig;
  correlation: CorrelationWeights;
  risk: RiskWeights;
}

export interface OpticalConfig {
  brightnessThreshold: number;    // 0-255
  minClusterPx: number;
  maxClusterPx: number;
  persistFramesRequired: number;
  compactnessMin: number;
  maxSaturation: number;
  confidenceThreshold: number;    // 0.0-1.0
  overexposureThreshold: number;  // 0-1 normalized brightness
  minFramesForQuality: number;
  differentialMinDelta: number;   // diferencia mínima torch_on vs torch_off
}

export interface MagneticConfig {
  baselineSampleMs: number;
  anomalyDeltaUt: number;
  anomalyConfirmCount: number;
  madMultiplier: number;          // umbral = mediana + MAD * multiplier
  baselineDriftCalm: number;
  baselineDriftActive: number;
  spatialGradientThreshold: number;
  saturationThreshold: number;    // máximo µT antes de considerar sensor saturado
  minCalibrationSamples: number;
}

export interface BleConfig {
  minRssiForProximity: number;    // dBm, más negativo = más lejos
  persistenceMinOccurrences: number;
  rssiVariationWindow: number;    // número de lecturas para calcular variación
  whitelistFamiliarDevices: boolean;
}

export interface NetworkConfig {
  mdnsEnabled: boolean;
  ssdpEnabled: boolean;
  onvifEnabled: boolean;
  rtspPortsToCheck: number[];
  scanTimeoutMs: number;
  maxHostsPerScan: number;
}

export interface CorrelationWeights {
  temporalWeight: number;
  spatialWeight: number;
  causalWeight: number;
  confidenceWeight: number;
  benignPenalty: number;
}

export interface RiskWeights {
  infoWeight: number;
  suspiciousWeight: number;
  highWeight: number;
  corroborationBonus: number;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  version: '1.0.0',
  optical: {
    brightnessThreshold: 240,
    minClusterPx: 3,
    maxClusterPx: 500,
    persistFramesRequired: 6,
    compactnessMin: 0.30,
    maxSaturation: 0.30,
    confidenceThreshold: 0.65,
    overexposureThreshold: 0.95,
    minFramesForQuality: 4,
    differentialMinDelta: 30,
  },
  magnetic: {
    baselineSampleMs: 3000,
    anomalyDeltaUt: 25,
    anomalyConfirmCount: 3,
    madMultiplier: 3.5,
    baselineDriftCalm: 0.04,
    baselineDriftActive: 0.004,
    spatialGradientThreshold: 15,
    saturationThreshold: 400,
    minCalibrationSamples: 10,
  },
  ble: {
    minRssiForProximity: -70,
    persistenceMinOccurrences: 2,
    rssiVariationWindow: 10,
    whitelistFamiliarDevices: true,
  },
  network: {
    mdnsEnabled: true,
    ssdpEnabled: true,
    onvifEnabled: true,
    rtspPortsToCheck: [554, 8554, 10554],
    scanTimeoutMs: 5000,
    maxHostsPerScan: 50,
  },
  correlation: {
    temporalWeight: 0.25,
    spatialWeight: 0.30,
    causalWeight: 0.25,
    confidenceWeight: 0.20,
    benignPenalty: 0.50,
  },
  risk: {
    infoWeight: 0,
    suspiciousWeight: 15,
    highWeight: 35,
    corroborationBonus: 20,
  },
};
