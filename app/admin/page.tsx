'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppNav } from '@/components/app-nav';
import { useAuth } from '@/lib/auth-context';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2, ShieldOff, Copy, CreditCard, SlidersHorizontal,
  Key, CheckCircle2, Save, RotateCcw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';

interface CodeRow { code: string; isRedeemed: boolean; redeemedAt: string | null; }
interface Calibration {
  brightnessThreshold: number; persistFrames: number; compactnessMin: number;
  magneticDeltaUt: number; magneticConfirmCount: number;
}
interface StripeStatus {
  hasSecretKey: boolean; hasWebhookSecret: boolean; hasPriceId: boolean;
  mode: 'live' | 'test'; priceId: string;
}

function Section({ title, icon: Icon, color, children, defaultOpen = true }: {
  title: string; icon: React.ElementType; color: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-card/80"
      >
        <div className="flex items-center gap-3">
          <div className={`flex size-9 items-center justify-center rounded-xl ${color}`}>
            <Icon className="size-4 text-white" aria-hidden />
          </div>
          <h2 className="font-display text-base font-semibold">{title}</h2>
        </div>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border/40 p-5">{children}</div>}
    </div>
  );
}

function Slider({ label, description, value, min, max, step = 1, onChange }: {
  label: string; description: string; value: number;
  min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-primary"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min}</span>
        <span className="text-center">{description}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user, loading } = useAuth();

  const [codes, setCodes]           = useState<CodeRow[] | null>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [defaults, setDefaults]     = useState<Calibration | null>(null);
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Stripe form state
  const [secretKey, setSecretKey]         = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [priceId, setPriceId]             = useState('');
  const [stripeMode, setStripeMode]       = useState<'live' | 'test'>('test');
  const [savingStripe, setSavingStripe]   = useState(false);
  const [savingCal, setSavingCal]         = useState(false);

  const loadAll = useCallback(async () => {
    const [codesRes, settingsRes] = await Promise.all([
      fetch('/api/admin/codes').then((r) => r.json()),
      fetch('/api/admin/settings').then((r) => r.json()),
    ]);
    if (codesRes.success) setCodes(codesRes.data);
    if (settingsRes.success) {
      setCalibration(settingsRes.data.calibration);
      setDefaults(settingsRes.data.defaults);
      setStripeStatus(settingsRes.data.stripe);
      setStripeMode(settingsRes.data.stripe.mode ?? 'test');
      setPriceId(settingsRes.data.stripe.priceId ?? '');
    }
    setLoadingSettings(false);
  }, []);

  useEffect(() => { if (user?.isAdmin) loadAll(); }, [user, loadAll]);

  if (loading) return <Loader2 className="mx-auto mt-20 size-6 animate-spin text-muted-foreground" />;
  if (!user?.isAdmin) return (
    <div className="min-h-screen"><AppNav />
      <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center">
        <ShieldOff className="size-8 text-destructive" aria-hidden />
        <p className="text-sm text-muted-foreground">Acceso restringido al creador de la app.</p>
      </main>
    </div>
  );

  const redeemedCount = codes?.filter((c) => c.isRedeemed).length ?? 0;

  const handleSaveStripe = async () => {
    setSavingStripe(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'stripe', data: { secretKey, webhookSecret, priceId, mode: stripeMode } }),
      });
      const payload = await res.json();
      if (payload.success) {
        toast.success('Configuración de Stripe guardada');
        setSecretKey(''); setWebhookSecret('');
        await loadAll();
      } else toast.error(payload.error ?? 'Error');
    } finally { setSavingStripe(false); }
  };

  const handleSaveCalibration = async () => {
    if (!calibration) return;
    setSavingCal(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'calibration', data: calibration }),
      });
      const payload = await res.json();
      if (payload.success) toast.success('Calibración guardada');
      else toast.error(payload.error ?? 'Error');
    } finally { setSavingCal(false); }
  };

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">

        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Panel del creador</h1>
          <p className="text-sm text-muted-foreground">Liora CamWard — configuración, Stripe y calibración del detector</p>
        </div>

        {/* ── 1. STRIPE ─────────────────────────────────────────────────────── */}
        <Section title="Stripe — Pagos premium" icon={CreditCard} color="bg-violet-600">
          {loadingSettings ? <Loader2 className="size-4 animate-spin" /> : (
            <div className="flex flex-col gap-5">
              {/* Estado actual */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Secret Key', ok: stripeStatus?.hasSecretKey },
                  { label: 'Webhook Secret', ok: stripeStatus?.hasWebhookSecret },
                  { label: 'Price ID', ok: stripeStatus?.hasPriceId },
                  { label: 'Modo', ok: true, value: stripeStatus?.mode === 'live' ? '🟢 Live' : '🟡 Test' },
                ].map(({ label, ok, value }) => (
                  <div key={label} className="rounded-lg border border-border/50 bg-card/50 p-3">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      {value ? (
                        <span className="text-xs font-medium">{value}</span>
                      ) : ok ? (
                        <><CheckCircle2 className="size-3.5 text-green-400" /><span className="text-xs text-green-400">Configurado</span></>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">No configurado</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Las claves se guardan cifradas en la base de datos y nunca se muestran en pantalla.
                Déjalas vacías si no quieres cambiarlas.
              </p>

              {/* Formulario */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sk" className="flex items-center gap-1.5 text-xs">
                    <Key className="size-3" /> Secret Key
                    <span className="text-muted-foreground/60">(sk_live_… o sk_test_…)</span>
                  </Label>
                  <Input id="sk" type="password" placeholder="sk_••••••••" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} className="font-mono text-xs" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="whs" className="flex items-center gap-1.5 text-xs">
                    <Key className="size-3" /> Webhook Secret
                    <span className="text-muted-foreground/60">(whsec_…)</span>
                  </Label>
                  <Input id="whs" type="password" placeholder="whsec_••••••••" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} className="font-mono text-xs" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pid" className="text-xs">Price ID del producto Premium</Label>
                  <Input id="pid" placeholder="price_…" value={priceId} onChange={(e) => setPriceId(e.target.value)} className="font-mono text-xs" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Modo</Label>
                  <div className="flex gap-2">
                    {(['test', 'live'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setStripeMode(m)}
                        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                          stripeMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 text-muted-foreground'
                        }`}
                      >{m === 'live' ? '🟢 Live (producción)' : '🟡 Test (desarrollo)'}</button>
                    ))}
                  </div>
                </div>
              </div>

              <Button onClick={handleSaveStripe} disabled={savingStripe} className="w-fit gap-2">
                {savingStripe ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Guardar configuración de Stripe
              </Button>

              <div className="rounded-lg border border-border/40 bg-card/40 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground/80 mb-1">¿Cómo obtener las claves?</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Entra en <span className="font-mono">dashboard.stripe.com</span> → Developers → API Keys</li>
                  <li>Copia la <strong>Secret key</strong> (sk_live_… para producción)</li>
                  <li>En Webhooks → añade endpoint: <span className="font-mono">{typeof window !== 'undefined' ? window.location.origin : 'https://tudominio.com'}/api/premium/webhook</span></li>
                  <li>Copia el <strong>Webhook signing secret</strong> (whsec_…)</li>
                  <li>En Products → crea un precio recurrente → copia el <strong>Price ID</strong> (price_…)</li>
                </ol>
              </div>
            </div>
          )}
        </Section>

        {/* ── 2. CALIBRADORES ───────────────────────────────────────────────── */}
        <Section title="Calibración del detector" icon={SlidersHorizontal} color="bg-cyan-600">
          {loadingSettings || !calibration ? <Loader2 className="size-4 animate-spin" /> : (
            <div className="flex flex-col gap-6">
              <p className="text-xs text-muted-foreground">
                Ajusta la sensibilidad de cada módulo de detección. Valores más bajos = más sensible (más detecciones, posibles falsos positivos). Valores más altos = más estricto (menos detecciones, mayor precisión).
              </p>

              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">📷 Módulo óptico (cámara)</p>
                <div className="mt-3 flex flex-col gap-5">
                  <Slider
                    label="Umbral de brillo" description="Brillo mínimo para detectar un reflejo"
                    min={200} max={255} value={calibration.brightnessThreshold}
                    onChange={(v) => setCalibration((c) => c && ({ ...c, brightnessThreshold: v }))}
                  />
                  <Slider
                    label="Frames de persistencia" description="Cuántos frames consecutivos debe persistir"
                    min={3} max={20} value={calibration.persistFrames}
                    onChange={(v) => setCalibration((c) => c && ({ ...c, persistFrames: v }))}
                  />
                  <Slider
                    label="Compacidad mínima" description="Qué tan redondo debe ser el cluster (0=elongado, 1=círculo)"
                    min={0.1} max={0.9} step={0.05} value={calibration.compactnessMin}
                    onChange={(v) => setCalibration((c) => c && ({ ...c, compactnessMin: v }))}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1 border-t border-border/40 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">🧲 Módulo magnético</p>
                <div className="mt-3 flex flex-col gap-5">
                  <Slider
                    label="Delta mínimo (µT)" description="Diferencia mínima respecto a la línea base"
                    min={10} max={80} value={calibration.magneticDeltaUt}
                    onChange={(v) => setCalibration((c) => c && ({ ...c, magneticDeltaUt: v }))}
                  />
                  <Slider
                    label="Lecturas consecutivas" description="Cuántas lecturas seguidas deben superar el delta"
                    min={1} max={10} value={calibration.magneticConfirmCount}
                    onChange={(v) => setCalibration((c) => c && ({ ...c, magneticConfirmCount: v }))}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={handleSaveCalibration} disabled={savingCal} className="gap-2">
                  {savingCal ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Guardar calibración
                </Button>
                {defaults && (
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setCalibration(defaults)}>
                    <RotateCcw className="size-3.5" /> Restaurar valores por defecto
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Los cambios aplican a todos los usuarios de la app en el siguiente escaneo. Los valores por defecto están optimizados para minimizar falsos positivos.
              </p>
            </div>
          )}
        </Section>

        {/* ── 3. CÓDIGOS PREMIUM ────────────────────────────────────────────── */}
        <Section title={`Códigos premium — ${redeemedCount} / 50 canjeados`} icon={Key} color="bg-amber-600" defaultOpen={false}>
          {!codes ? <Loader2 className="size-4 animate-spin" /> : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                {50 - redeemedCount} códigos disponibles para repartir. Cada código da acceso premium de por vida.
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Canjeado el</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codes.map((c) => (
                      <TableRow key={c.code}>
                        <TableCell className="font-mono text-xs">{c.code}</TableCell>
                        <TableCell>
                          <Badge variant={c.isRedeemed ? 'secondary' : 'outline'}>
                            {c.isRedeemed ? 'Canjeado' : 'Disponible'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.redeemedAt ? new Date(c.redeemedAt).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>
                          {!c.isRedeemed && (
                            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(c.code); toast.success('Código copiado'); }}>
                              <Copy className="size-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </Section>

      </main>
    </div>
  );
}
