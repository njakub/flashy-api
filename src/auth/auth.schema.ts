import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const googleSchema = z.object({
  idToken: z.string().min(1),
});
export type GoogleDto = z.infer<typeof googleSchema>;

export const appleSchema = z.object({
  identityToken: z.string().min(1),
  /// One-shot code from the native sheet — exchanged for a revocable Apple
  /// refresh token when the Apple key env vars are configured.
  authorizationCode: z.string().min(1).optional(),
  /// Only present on the user's FIRST authorization; Apple never sends the
  /// name in the identity token itself.
  fullName: z
    .object({
      givenName: z.string().max(200).optional(),
      familyName: z.string().max(200).optional(),
    })
    .optional(),
});
export type AppleDto = z.infer<typeof appleSchema>;
