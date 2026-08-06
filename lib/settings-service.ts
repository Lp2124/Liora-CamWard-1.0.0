import 'server-only';
import { db } from '@/db';
import { appSettings } from '@/db/schemas';
import { eq } from 'drizzle-orm';

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ── Typed helpers for known keys ─────────────────────────────────────────────

export interface ScanCalibration {
  brightnessThreshold: number;   // 200–255, default 245
  persistFrames: number;         // 4–20, default 8
  compactnessMin: number;        // 0.1–0.9, default 0.35
  magneticDeltaUt: number;       // 10–80, default 30
  magneticConfirmCount: number;  // 1–10, default 3
}

export const DEFAULT_CALIBRATION: ScanCalibration = {
  brightnessThreshold: 245,
  persistFrames: 8,
  compactnessMin: 0.35,
  magneticDeltaUt: 30,
  magneticConfirmCount: 3,
};

export async function getScanCalibration(): Promise<ScanCalibration> {
  const raw = await getSetting('scan.calibration');
  if (!raw) return DEFAULT_CALIBRATION;
  try {
    return { ...DEFAULT_CALIBRATION, ...(JSON.parse(raw) as Partial<ScanCalibration>) };
  } catch {
    return DEFAULT_CALIBRATION;
  }
}

export async function setScanCalibration(cal: Partial<ScanCalibration>): Promise<void> {
  const current = await getScanCalibration();
  await setSetting('scan.calibration', JSON.stringify({ ...current, ...cal }));
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  mode: 'live' | 'test';
}

export async function getStripeConfig(): Promise<Partial<StripeConfig>> {
  const raw = await getSetting('stripe.config');
  if (!raw) return {};
  try { return JSON.parse(raw) as Partial<StripeConfig>; }
  catch { return {}; }
}

export async function setStripeConfig(cfg: Partial<StripeConfig>): Promise<void> {
  const current = await getStripeConfig();
  // Never store empty strings — treat them as "unchanged"
  const merged: Partial<StripeConfig> = { ...current };
  if (cfg.secretKey?.trim())     merged.secretKey     = cfg.secretKey.trim();
  if (cfg.webhookSecret?.trim()) merged.webhookSecret = cfg.webhookSecret.trim();
  if (cfg.priceId?.trim())       merged.priceId       = cfg.priceId.trim();
  if (cfg.mode)                  merged.mode          = cfg.mode;
  await setSetting('stripe.config', JSON.stringify(merged));
}
