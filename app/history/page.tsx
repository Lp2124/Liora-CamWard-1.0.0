'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '@/components/app-nav';
import { useI18n } from '@/lib/i18n/context';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronRight } from 'lucide-react';

interface SessionRow {
  id: string;
  startedAt: string;
  status: string;
  riskLevel: string | null;
  label: string | null;
}

const RISK_LABEL_KEY = { clear: 'riskClear', low: 'riskLow', medium: 'riskMedium', high: 'riskHigh' } as const;

export default function HistoryPage() {
  const { t } = useI18n();
  const { user, loading: authLoading, login } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch('/api/scans')
      .then((r) => r.json())
      .then((payload) => setSessions(payload.success ? payload.data : []));
  }, [user]);

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t('historyTitle')}</h1>

        {authLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden />
        ) : !user ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">{t('loginCta')}</p>
            <Button onClick={login}>{t('loginCta')}</Button>
          </div>
        ) : sessions === null ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden />
        ) : sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {t('historyEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/history/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-card p-4 transition hover:border-primary/50"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">
                      {new Date(s.startedAt).toLocaleString()}
                    </span>
                    {s.riskLevel && (
                      <Badge variant="outline" className="w-fit" style={{ borderColor: `var(--risk-${s.riskLevel})`, color: `var(--risk-${s.riskLevel})` }}>
                        {t(RISK_LABEL_KEY[s.riskLevel as keyof typeof RISK_LABEL_KEY])}
                      </Badge>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
