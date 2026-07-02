import { randomBytes, createHash } from 'crypto';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Opaque, high-entropy refresh token — never a JWT, never stored raw. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/** Refresh tokens are stored/looked-up by hash only — DB compromise doesn't leak usable tokens. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
