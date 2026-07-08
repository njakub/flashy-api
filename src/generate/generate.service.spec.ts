// Mocked before the GenerateService import below: the real PrismaService
// transitively pulls in the generated Prisma client, which uses
// `import.meta.url` in a way ts-jest's isolated-module transpile doesn't
// support (CJS interop for that syntax needs full-program type info).
// Mocking the module keeps this a pure unit test of the PDF-fallback logic
// without needing a real database or Prisma client at all.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: jest.fn() }));

import { GenerateService } from './generate.service';
import type { LlmService, RunOpts, RunResult } from '../llm/llm.service';
import type { PrismaService } from '../prisma/prisma.service';
import { GENERATION_DEFAULT_MODEL } from '../llm/models';

function makeService(generationModel: string | null) {
  const run = jest
    .fn<
      Promise<RunResult<{ cards: unknown[] }>>,
      [RunOpts<{ cards: unknown[] }>]
    >()
    .mockResolvedValue({
      output: { cards: [] },
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      usageId: 'usage-1',
    });
  const llm = { run } as unknown as LlmService;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ generationModel }) },
  } as unknown as PrismaService;
  return { service: new GenerateService(llm, prisma), run };
}

describe('GenerateService PDF capability fallback', () => {
  it('falls back to the generation task default when the stored model cannot take a PDF', async () => {
    const { service, run } = makeService('deepseek-v4-flash'); // supportsPdf: false
    await service.generate('user-1', {
      source: { type: 'pdf', data: 'JVBERi0xLjQK' },
      targetCount: 5,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].model.id).toBe(GENERATION_DEFAULT_MODEL);
  });

  it('uses the stored model as-is for text input even if it cannot take a PDF', async () => {
    const { service, run } = makeService('deepseek-v4-flash');
    await service.generate('user-1', {
      source: { type: 'text', text: 'source material' },
      targetCount: 5,
    });
    expect(run.mock.calls[0][0].model.id).toBe('deepseek-v4-flash');
  });

  it('uses the stored model as-is for a PDF when it does support PDF input', async () => {
    const { service, run } = makeService('claude-opus-4-8'); // supportsPdf: true
    await service.generate('user-1', {
      source: { type: 'pdf', data: 'JVBERi0xLjQK' },
      targetCount: 5,
    });
    expect(run.mock.calls[0][0].model.id).toBe('claude-opus-4-8');
  });
});
