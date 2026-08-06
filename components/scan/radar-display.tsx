'use client';

import { cn } from '@/utils/cn';
import type { RiskLevel } from '@/lib/scan/risk';

const RISK_COLOR: Record<RiskLevel, string> = {
  clear: 'var(--risk-clear)',
  low: 'var(--risk-low)',
  medium: 'var(--risk-medium)',
  high: 'var(--risk-high)',
};

interface RadarDisplayProps {
  active: boolean;
  riskLevel: RiskLevel;
  findingCount: number;
}

/**
 * The signature element: a live radar sweep whose glow color reflects the
 * real, evidence-derived risk level — never decorative randomness.
 */
export function RadarDisplay({ active, riskLevel, findingCount }: RadarDisplayProps) {
  const color = RISK_COLOR[riskLevel];

  return (
    <div className="relative mx-auto flex size-56 items-center justify-center sm:size-64">
      {active && (
        <>
          <span className="radar-ping absolute inset-0 rounded-full border" style={{ borderColor: color }} />
          <span className="radar-ping absolute inset-0 rounded-full border" style={{ borderColor: color, animationDelay: '1.1s' }} />
        </>
      )}

      <div
        className="absolute inset-0 rounded-full border transition-colors duration-500"
        style={{ borderColor: 'var(--radar-ring)' }}
      />
      <div
        className="absolute inset-6 rounded-full border transition-colors duration-500"
        style={{ borderColor: 'var(--radar-ring)' }}
      />
      <div
        className="absolute inset-12 rounded-full border transition-colors duration-500"
        style={{ borderColor: 'var(--radar-ring)' }}
      />

      {active && (
        <div className="radar-sweep absolute inset-0 rounded-full [mask-image:radial-gradient(circle,transparent_0%,black_100%)]">
          <div
            className="absolute inset-0 origin-center"
            style={{
              background: `conic-gradient(from 0deg, ${color} 0deg, transparent 60deg)`,
              borderRadius: '9999px',
            }}
          />
        </div>
      )}

      <div
        className={cn(
          'relative z-10 flex size-20 flex-col items-center justify-center rounded-full border-2 font-display transition-colors duration-500 sm:size-24',
        )}
        style={{ borderColor: color, boxShadow: active ? `0 0 40px -6px ${color}` : undefined }}
      >
        <span className="text-2xl font-semibold tabular-nums sm:text-3xl" style={{ color }}>
          {findingCount}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">hallazgos</span>
      </div>
    </div>
  );
}
