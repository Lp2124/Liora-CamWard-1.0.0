'use client';

import type { Finding } from '@/lib/scan/types';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n/context';
import { Wifi, Bluetooth, Camera, Compass } from 'lucide-react';

const MODULE_ICON = {
  network: Wifi,
  bluetooth: Bluetooth,
  optical: Camera,
  magnetic: Compass,
} as const;

const SEVERITY_VARIANT = {
  info: 'outline',
  suspicious: 'secondary',
  high: 'destructive',
} as const;

export function FindingCard({ finding }: { finding: Finding }) {
  const { t } = useI18n();
  const Icon = MODULE_ICON[finding.module];
  const severityLabel = { info: t('severityInfo'), suspicious: t('severitySuspicious'), high: t('severityHigh') }[finding.severity];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" aria-hidden />
          <p className="text-sm font-medium leading-tight">{finding.title}</p>
        </div>
        <Badge variant={SEVERITY_VARIANT[finding.severity]}>{severityLabel}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{finding.detail}</p>
    </div>
  );
}
