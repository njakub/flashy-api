import { z } from 'zod';

// Wire uses lowercase literals (mirrors the outcome convention in
// sync.schema.ts); the Prisma enum is uppercase — UsersService maps between
// the two explicitly.
export const gradingDefaultSchema = z.enum(['local', 'ai']);
export type GradingDefaultDto = z.infer<typeof gradingDefaultSchema>;

// gradingModel/generationModel are free-form strings here (not an enum) —
// they're registry ids (src/llm/models.ts) validated against the live
// registry in UsersService, not at the schema layer. Keeping that check out
// of the schema means adding a model to the registry never needs a schema
// change.
export const updateProfileSchema = z
  .object({
    gradingDefault: gradingDefaultSchema.optional(),
    gradingModel: z.string().min(1).optional(),
    generationModel: z.string().min(1).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
