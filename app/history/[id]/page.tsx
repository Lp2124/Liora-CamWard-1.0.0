'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { FindingCard } from '@/components/scan/finding-card';
import { useI18n } from '@/lib/i18n/context';
import type { Finding } from '@/lib/scan/types';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SessionDetail {
  session: { id: string; startedAt: string; riskLevel: string | null; modulesRun: string[] };
  findings: Array<{ module: string; severity: string; title: string; detail: string; evidence: unknown }>;
}

const RISK_LABEL_KEY = { clear: 'riskClear', low: 'riskLow', medium: 'riskMedium', high: 'riskHigh' } as const;

export default function ScanDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/scans/${params.id}`)
      .then((r) => r.json())
      .then((payload) => (payload.success ? setData(payload.data) : setError(payload.error)));
  }, [params.id]);

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="font-display text-xl font-semibold">
                {new Date(data.session.startedAt).toLocaleString()}
              </h1>
              {data.session.riskLevel && (
                <Badge
                  variant="outline"
                  style={{ borderColor: `var(--risk-${data.session.riskLevel})`, color: `var(--risk-${data.session.riskLevel})` }}
                >
                  {t(RISK_LABEL_KEY[data.session.riskLevel as keyof typeof RISK_LABEL_KEY])}
                </Badge>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {data.findings.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  {t('noFindings')}
                </p>
              ) : (
                data.findings.map((f) => <FindingCard key={f.title + f.module} finding={f as Finding} />)
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
