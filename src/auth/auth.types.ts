/** Shape of the access-token JWT payload this API issues and verifies. */
export interface JwtPayload {
  /** Subject — the User.id (cuid). */
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * The user object attached to req.user by the JWT strategy after a
 * successful access-token verification.
 */
export interface AuthUser {
  userId: string;
  email: string;
}
