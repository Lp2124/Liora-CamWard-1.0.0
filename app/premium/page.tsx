'use client';

import { useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { useI18n } from '@/lib/i18n/context';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Check, Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PremiumPage() {
  const { t } = useI18n();
  const { user, login, refresh } = useAuth();
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const handleRedeem = async () => {
    if (!user) return login();
    setRedeeming(true);
    try {
      const res = await fetch('/api/premium/redeem', { method: 'POST', body: JSON.stringify({ code }) });
      const payload = await res.json();
      if (payload.success) {
        toast.success(t('redeemSuccess'));
        setCode('');
        await refresh();
      } else {
        toast.error(t('redeemError'));
      }
    } finally {
      setRedeeming(false);
    }
  };

  const handleCheckout = async () => {
    if (!user) return login();
    setCheckingOut(true);
    try {
      const res = await fetch('/api/premium/checkout', { method: 'POST', body: JSON.stringify({}) });
      const payload = await res.json();
      if (payload.success) {
        window.location.href = payload.data.url;
      } else {
        toast.error(payload.error ?? 'Error');
      }
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        <div className="text-center">
          <Crown className="mx-auto size-8 text-accent" aria-hidden />
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">{t('premiumTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('premiumSubtitle')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('premiumFree')}</CardTitle>
              <CardDescription>{t('premiumFreeDesc')}</CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-primary/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t('premiumPro')}
                {user?.isPremium && <Badge className="gap-1"><Check className="size-3" aria-hidden />OK</Badge>}
              </CardTitle>
              <CardDescription>{t('premiumProDesc')}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={handleCheckout} disabled={checkingOut || user?.isPremium} className="w-full gap-2">
                {checkingOut && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('subscribe')}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('redeemCode')}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('redeemPlaceholder')}
              className="font-mono uppercase"
            />
            <Button onClick={handleRedeem} disabled={redeeming || !code}>
              {redeeming ? <Loader2 className="size-4 animate-spin" aria-hidden /> : t('redeemButton')}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
