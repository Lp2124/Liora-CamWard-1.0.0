import 'server-only';
import { randomBytes, createHash } from 'crypto';
import { db } from '@/db';
import { premiumCodes, appUsers, type AppUser } from '@/db/schemas';
import { eq, sql } from 'drizzle-orm';
import { ValidationError } from './errors';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function generateCode(): string {
  const bytes = randomBytes(12);
  let raw = '';
  for (const b of bytes) raw += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `CAMWARD-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/** Seeds exactly 50 lifetime premium codes. Safe to call repeatedly. */
export async function ensureFiftyCreatorCodes(): Promise<void> {
  const existing = await db.select({ code: premiumCodes.code }).from(premiumCodes);
  const missing = 50 - existing.length;
  if (missing <= 0) return;

  const rows = Array.from({ length: missing }, () => ({
    code: generateCode(),
    note: 'Creator lifetime premium giveaway (50 total)',
  }));
  await db.insert(premiumCodes).values(rows);
}

/**
 * Redime un código premium de forma atómica.
 *
 * Fase 4 — Corrección crítica de race condition:
 * Se usa UPDATE atómico con condición AND redeemed_at IS NULL para garantizar
 * que en condiciones de concurrencia solo un usuario pueda redimir el código.
 * No hay ventana de tiempo entre SELECT y UPDATE.
 *
 * Equivalente a:
 *   UPDATE premium_codes
 *   SET is_redeemed = TRUE, redeemed_by_openid = $1, redeemed_at = NOW()
 *   WHERE code = $2 AND is_redeemed = FALSE
 *   RETURNING *;
 */
export async function redeemCode(user: AppUser, rawCode: string): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new ValidationError('Introduce un código.');

  // ── Validar formato básico antes del DB round-trip ─────────────────────────
  if (!/^CAMWARD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    throw new ValidationError('CODE_INVALID');
  }

  // ── UPDATE atómico: solo actualiza si is_redeemed = FALSE ─────────────────
  // Si otra petición concurrente llegó primero, el WHERE is_redeemed = FALSE
  // no coincide y returning [] — se lanza CODE_ALREADY_USED.
  const result = await db
    .update(premiumCodes)
    .set({
      isRedeemed: true,
      redeemedByOpenid: user.openid,
      redeemedAt: new Date(),
    })
    .where(
      sql`${premiumCodes.code} = ${code}
          AND ${premiumCodes.isRedeemed} = FALSE`,
    )
    .returning({ code: premiumCodes.code });

  if (result.length === 0) {
    // Distinguir código inválido de código ya usado
    const existing = await db
      .select({ isRedeemed: premiumCodes.isRedeemed })
      .from(premiumCodes)
      .where(eq(premiumCodes.code, code))
      .limit(1);

    if (existing.length === 0) throw new ValidationError('CODE_INVALID');
    throw new ValidationError('CODE_ALREADY_USED');
  }

  // ── Actualizar usuario a premium ───────────────────────────────────────────
  await db
    .update(appUsers)
    .set({ isPremium: true, premiumLifetime: true, premiumSince: new Date() })
    .where(eq(appUsers.openid, user.openid));
}

export async function listCodesForAdmin() {
  return db.select().from(premiumCodes).orderBy(premiumCodes.createdAt);
}

/** Hash seguro para almacenamiento de códigos en futuras versiones */
export { hashCode };
