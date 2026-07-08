import { Module } from '@nestjs/common';
import { LLM_PROVIDERS } from './llm.constants';
import { LlmService } from './llm.service';
import { LlmUsageService } from './usage.service';
import { ModelsController } from './models.controller';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';

// Adding a fourth provider: implement LlmProvider, add it to `providers`
// below, and add it to the factory's `inject`/return array — LlmService
// itself dispatches by ModelDef.provider at runtime and needs no change.
@Module({
  controllers: [ModelsController],
  providers: [
    AnthropicProvider,
    GeminiProvider,
    DeepSeekProvider,
    {
      provide: LLM_PROVIDERS,
      useFactory: (
        anthropic: AnthropicProvider,
        gemini: GeminiProvider,
        deepseek: DeepSeekProvider,
      ) => [anthropic, gemini, deepseek],
      inject: [AnthropicProvider, GeminiProvider, DeepSeekProvider],
    },
    LlmUsageService,
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
