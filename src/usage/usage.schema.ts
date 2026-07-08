import { z } from 'zod';

export const usageRangeSchema = z.enum(['7d', '30d', '90d']).default('30d');
export type UsageRange = z.infer<typeof usageRangeSchema>;
