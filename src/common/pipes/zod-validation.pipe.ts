import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * A NestJS pipe that validates the incoming value against a zod schema.
 * Used on @Body(), @Query(), and @Param() decorators.
 *
 * Usage:
 *   @Body(new ZodValidationPipe(mySchema)) dto: MyDto
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
