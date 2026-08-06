export type ScanModule = 'network' | 'bluetooth' | 'optical' | 'magnetic';
export type Severity = 'info' | 'suspicious' | 'high';

export interface Finding {
  module: ScanModule;
  severity: Severity;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface ModuleAvailability {
  module: ScanModule;
  supported: boolean;
  permissionState: 'unknown' | 'prompt' | 'granted' | 'denied';
  reason?: string;
}

export type FindingListener = (finding: Finding) => void;
