'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n/context';
import { LanguageSwitcher } from '@/components/language-switcher';
import { AccountMenu } from '@/components/account-menu';
import { cn } from '@/utils/cn';
import { RadarIcon, HistoryIcon, CrownIcon } from 'lucide-react';

export function AppNav() {
  const { t } = useI18n();
  const pathname = usePathname();

  const items = [
    { href: '/', label: t('navScan'), icon: RadarIcon },
    { href: '/history', label: t('navHistory'), icon: HistoryIcon },
    { href: '/premium', label: t('navPremium'), icon: CrownIcon },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
          <span className="text-primary">Liora</span>
          <span>Scan</span>
        </Link>

        <nav className="flex items-center gap-1 rounded-full border border-border/70 bg-card/60 p-1">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <item.icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
