import { z } from 'zod';

// Wire uses lowercase literals (mirrors the outcome convention in
// sync.schema.ts); the Prisma enum is uppercase — UsersService maps between
// the two explicitly.
export const gradingDefaultSchema = z.enum(['local', 'ai']);
export type GradingDefaultDto = z.infer<typeof gradingDefaultSchema>;

export const updateProfileSchema = z.object({
  gradingDefault: gradingDefaultSchema,
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
