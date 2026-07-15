import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import type { RegisterDto, LoginDto, AppleDto } from './auth.schema';
import type { JwtPayload } from './auth.types';
import {
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
  verifyAppleIdentityToken,
} from './apple.util';
import {
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
} from './refresh-token.util';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly googleClient = new OAuth2Client(
    process.env['GOOGLE_CLIENT_ID'],
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash },
    });

    return this.issueTokens(user.id, user.email);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Also rejects Google-only accounts (passwordHash is null) — they have
    // no password to check against.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    return this.issueTokens(user.id, user.email);
  }

  /**
   * Verifies a Google ID token, then finds-or-links-or-creates the User:
   *   1. Existing googleId match -> that user.
   *   2. Else existing email match (only if Google verified the email) ->
   *      link googleId onto that account (works for both email/password
   *      and previously-Google users signing in from a new client).
   *   3. Else create a new Google-only user (passwordHash stays null).
   * Issues our own JWTs exactly like login()/register() — Google only
   * authenticates the person, it never becomes the session mechanism.
   */
  async googleSignIn(idToken: string): Promise<AuthTokens> {
    // verifyIdToken throws (not returns) for a malformed, expired, or
    // wrong-audience token — that's a bad-credentials client error (401),
    // not a server fault, so it must not be left to fall through as a 500.
    const payload = await this.googleClient
      .verifyIdToken({ idToken, audience: process.env['GOOGLE_CLIENT_ID'] })
      .then((ticket) => ticket.getPayload())
      .catch(() => undefined);

    if (!payload?.email || !payload.email_verified) {
      throw new UnauthorizedException(
        'Invalid Google token or unverified email',
      );
    }

    const { sub: googleId, email, name, picture: image } = payload;

    let user = await this.prisma.user.findUnique({ where: { googleId } });

    if (!user) {
      user = await this.prisma.user.findUnique({ where: { email } });
      user = user
        ? await this.prisma.user.update({
            where: { id: user.id },
            data: { googleId },
          })
        : await this.prisma.user.create({
            data: { email, googleId, name, image },
          });
    }

    return this.issueTokens(user.id, user.email);
  }

  /**
   * Sign in with Apple — same find-or-link-or-create shape as googleSignIn,
   * keyed on appleId. Differences forced by Apple's model:
   *   - The name never appears in the identity token; the client forwards
   *     fullName from the native sheet, and only on FIRST authorization.
   *   - A repeat sign-in for an unknown appleId with no verified email in
   *     the token cannot be linked or created -> 401.
   *   - authorizationCode (when present and Apple key env vars are set) is
   *     exchanged for an Apple refresh token, stored so deleteAccount can
   *     revoke Apple's grant. Best-effort: sign-in never fails on it.
   */
  async appleSignIn(dto: AppleDto): Promise<AuthTokens> {
    const identity = await verifyAppleIdentityToken(dto.identityToken);
    if (!identity) {
      throw new UnauthorizedException('Invalid Apple identity token');
    }

    const { sub: appleId, email, emailVerified } = identity;

    let user = await this.prisma.user.findUnique({ where: { appleId } });

    if (!user) {
      if (!email || !emailVerified) {
        throw new UnauthorizedException(
          'Apple token has no verified email to create or link an account',
        );
      }
      const name =
        [dto.fullName?.givenName, dto.fullName?.familyName]
          .filter(Boolean)
          .join(' ') || undefined;

      const existing = await this.prisma.user.findUnique({ where: { email } });
      user = existing
        ? await this.prisma.user.update({
            where: { id: existing.id },
            data: { appleId },
          })
        : await this.prisma.user.create({ data: { email, appleId, name } });
    }

    if (dto.authorizationCode) {
      const appleRefreshToken = await exchangeAppleAuthorizationCode(
        dto.authorizationCode,
      );
      if (appleRefreshToken) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { appleRefreshToken },
        });
      }
    }

    return this.issueTokens(user.id, user.email);
  }

  /**
   * Account deletion (App Store Guideline 5.1.1(v)): revoke Apple's grant
   * when one is stored (best-effort), then hard-delete everything the user
   * owns. Decks cascade to cards/test runs/questions; the user row cascades
   * to refresh tokens and LLM usage. Idempotent — deleting an already-gone
   * account is a no-op.
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    if (user.appleRefreshToken) {
      const revoked = await revokeAppleRefreshToken(user.appleRefreshToken);
      if (!revoked) {
        this.logger.warn(
          `Apple token revocation failed for user ${userId} — proceeding with deletion`,
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.deck.deleteMany({ where: { ownerId: userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }

  /** Rotates the refresh token: the old one is revoked, a new pair issued. */
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !stored ||
      stored.revokedAt !== null ||
      stored.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user.id, stored.user.email);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken, user: { id: userId, email } };
  }
}
