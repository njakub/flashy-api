/**
 * Sign in with Apple helpers — identity-token verification plus the
 * optional authorization-code exchange / token revocation used by account
 * deletion (docs in flashy-mobile: docs/social-auth-api.md).
 *
 * Verification is mandatory and needs no credentials (public JWKS).
 * Exchange/revocation additionally need an Apple "client secret" — an ES256
 * JWT signed with a Sign in with Apple private key — and are skipped
 * (best-effort) unless APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY are
 * configured.
 */
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys'),
);

/** The identity token's `aud` is the app's bundle id, not an OAuth client. */
const APPLE_BUNDLE_ID = process.env['APPLE_BUNDLE_ID'] ?? 'com.flashy.mobile';

export interface AppleIdentity {
  /** Apple's stable per-user id — the account-linking key. */
  sub: string;
  email?: string;
  emailVerified: boolean;
}

/**
 * Verifies signature (Apple JWKS), issuer, audience, and expiry. Returns
 * undefined for any invalid token — the caller maps that to a 401, never a
 * 500 (same convention as googleSignIn's verifyIdToken catch).
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
): Promise<AppleIdentity | undefined> {
  try {
    const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience: APPLE_BUNDLE_ID,
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return undefined;
    }
    // Apple serializes email_verified as boolean OR the string "true".
    const emailVerified =
      payload['email_verified'] === true ||
      payload['email_verified'] === 'true';
    return {
      sub: payload.sub,
      email:
        typeof payload['email'] === 'string' ? payload['email'] : undefined,
      emailVerified,
    };
  } catch {
    return undefined;
  }
}

export function appleTokenExchangeConfigured(): boolean {
  return Boolean(
    process.env['APPLE_TEAM_ID'] &&
    process.env['APPLE_KEY_ID'] &&
    process.env['APPLE_PRIVATE_KEY'],
  );
}

/**
 * The "client secret" for Apple's /auth/token and /auth/revoke endpoints:
 * a short-lived ES256 JWT signed with the Sign in with Apple key (.p8).
 * APPLE_PRIVATE_KEY holds the PKCS#8 PEM, with literal \n escapes allowed
 * (the usual single-line env-var encoding).
 */
async function appleClientSecret(): Promise<string> {
  const pem = process.env['APPLE_PRIVATE_KEY']!.replace(/\\n/g, '\n');
  const key = await importPKCS8(pem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env['APPLE_KEY_ID']! })
    .setIssuer(process.env['APPLE_TEAM_ID']!)
    .setSubject(APPLE_BUNDLE_ID)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

/**
 * Exchanges the one-shot authorizationCode from the native sign-in sheet for
 * Apple's token pair, returning the refresh token (stored on the user so
 * account deletion can revoke it). Returns undefined on any failure —
 * sign-in must succeed regardless.
 */
export async function exchangeAppleAuthorizationCode(
  code: string,
): Promise<string | undefined> {
  if (!appleTokenExchangeConfigured()) return undefined;
  try {
    const res = await fetch(`${APPLE_ISSUER}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: APPLE_BUNDLE_ID,
        client_secret: await appleClientSecret(),
      }),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { refresh_token?: string };
    return data.refresh_token;
  } catch {
    return undefined;
  }
}

/** Revokes a stored Apple refresh token. Best-effort: account deletion
 * proceeds even if Apple is unreachable. Returns whether Apple accepted. */
export async function revokeAppleRefreshToken(
  refreshToken: string,
): Promise<boolean> {
  if (!appleTokenExchangeConfigured()) return false;
  try {
    const res = await fetch(`${APPLE_ISSUER}/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: refreshToken,
        token_type_hint: 'refresh_token',
        client_id: APPLE_BUNDLE_ID,
        client_secret: await appleClientSecret(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
