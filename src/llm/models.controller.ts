import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  GENERATION_DEFAULT_MODEL,
  GRADING_DEFAULT_MODEL,
  MODELS,
} from './models';

@Controller('models')
export class ModelsController {
  /**
   * The registry, as-is — the single source the frontend reads for dropdown
   * options, price hints, and PDF-capability badges, so pricing never needs
   * a second hand-mirrored copy client-side. Guarded like every other route;
   * pricing exposure to a signed-in user is intentional, it's what powers
   * the "grade with X (~$0.10/1M in)" style labels.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  list() {
    return {
      models: MODELS,
      defaults: {
        grading: GRADING_DEFAULT_MODEL,
        generation: GENERATION_DEFAULT_MODEL,
      },
    };
  }
}
