'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n/context';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, LogOut } from 'lucide-react';

export function AccountMenu() {
  const { user, loading, login, logout } = useAuth();
  const { t } = useI18n();

  if (loading) return <div className="size-8 rounded-full bg-muted" aria-hidden />;

  if (!user) {
    return (
      <Button size="sm" onClick={login} className="gap-1.5">
        {t('loginCta')}
      </Button>
    );
  }

  const initials = (user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Avatar className="size-8">
            <AvatarImage src={user.avatarUrl ?? undefined} alt="" />
            <AvatarFallback translate="no">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate text-sm font-medium" translate="no">
            {user.displayName ?? user.email}
          </span>
          {user.isPremium && (
            <Badge variant="secondary" className="w-fit gap-1 text-[10px]">
              <ShieldCheck className="size-3" aria-hidden />
              {t('accountPremiumBadge')}
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">{t('adminPanel')}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => logout()} className="gap-2 text-destructive focus:text-destructive">
          <LogOut className="size-4" aria-hidden />
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
