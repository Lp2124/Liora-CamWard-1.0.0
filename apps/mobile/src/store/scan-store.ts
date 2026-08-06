/**
 * apps/mobile — Scan Store (Zustand)
 *
 * Estado global del escaneo. El store NUNCA calcula riesgo ni severity.
 * Esos valores vienen del servidor vía ObservationAnalysisResponse.
 *
 * Versión: 1.0.0
 */

import { create } from 'zustand';
import type { RiskResult, Finding, VisualVerdict } from '@liora/contracts';
import type { MagneticNativeProgress } from '../modules/magnetic/magnetometer-native';

export type ScanPhase =
  | 'idle'
  | 'requesting_permissions'
  | 'calibrating'
  | 'scanning'
  | 'analyzing'
  | 'completed'
  | 'error';

export interface ScanState {
  phase: ScanPhase;
  inspectionId: string | null;
  findings: Finding[];
  riskResult: RiskResult | null;
  magneticProgress: MagneticNativeProgress | null;
  opticalVerdict: VisualVerdict | null;
  bleDevicesFound: number;
  error: string | null;
  modulesCompleted: Set<string>;
}

export interface ScanActions {
  setPhase: (phase: ScanPhase) => void;
  setInspectionId: (id: string) => void;
  addFindings: (findings: Finding[], risk: RiskResult) => void;
  setMagneticProgress: (progress: MagneticNativeProgress) => void;
  setOpticalVerdict: (verdict: VisualVerdict) => void;
  setBleDevicesFound: (count: number) => void;
  setError: (error: string | null) => void;
  markModuleComplete: (module: string) => void;
  reset: () => void;
}

const INITIAL_STATE: ScanState = {
  phase: 'idle',
  inspectionId: null,
  findings: [],
  riskResult: null,
  magneticProgress: null,
  opticalVerdict: null,
  bleDevicesFound: 0,
  error: null,
  modulesCompleted: new Set(),
};

export const useScanStore = create<ScanState & ScanActions>((set) => ({
  ...INITIAL_STATE,

  setPhase: (phase) => set({ phase }),
  setInspectionId: (id) => set({ inspectionId: id }),

  addFindings: (newFindings, risk) =>
    set((state) => {
      // Deduplicar por id
      const existingIds = new Set(state.findings.map((f) => f.id));
      const unique = newFindings.filter((f) => !f.id || !existingIds.has(f.id));
      return {
        findings: [...state.findings, ...unique],
        riskResult: risk, // siempre el más reciente del servidor
      };
    }),

  setMagneticProgress: (progress) => set({ magneticProgress: progress }),
  setOpticalVerdict: (verdict) => set({ opticalVerdict: verdict }),
  setBleDevicesFound: (count) => set({ bleDevicesFound: count }),
  setError: (error) => set({ error }),
  markModuleComplete: (module) =>
    set((state) => ({
      modulesCompleted: new Set([...state.modulesCompleted, module]),
    })),

  reset: () => set({ ...INITIAL_STATE, modulesCompleted: new Set() }),
}));
