import { z } from 'zod';
import { parseJsonWithRetry } from './structured';
import { LlmParseError } from './provider';

const schema = z.object({ outcome: z.enum(['correct', 'incorrect']) });

function mockRetry(resolvedValue?: string) {
  const fn = jest.fn<Promise<string>, [string]>();
  if (resolvedValue !== undefined) fn.mockResolvedValue(resolvedValue);
  return fn;
}

describe('parseJsonWithRetry', () => {
  it('parses valid JSON on the first attempt without retrying', async () => {
    const retry = mockRetry();
    const result = await parseJsonWithRetry(
      schema,
      '{"outcome":"correct"}',
      retry,
    );
    expect(result).toEqual({ outcome: 'correct' });
    expect(retry).not.toHaveBeenCalled();
  });

  it('strips a markdown fence before parsing', async () => {
    const retry = mockRetry();
    const result = await parseJsonWithRetry(
      schema,
      '```json\n{"outcome":"correct"}\n```',
      retry,
    );
    expect(result).toEqual({ outcome: 'correct' });
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries once on invalid JSON and succeeds if the retry is valid', async () => {
    const retry = mockRetry('{"outcome":"incorrect"}');
    const result = await parseJsonWithRetry(schema, 'not json at all', retry);
    expect(result).toEqual({ outcome: 'incorrect' });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0]).toMatch(/not valid JSON/);
  });

  it('retries once on schema-invalid JSON and succeeds if the retry is valid', async () => {
    const retry = mockRetry('{"outcome":"correct"}');
    const result = await parseJsonWithRetry(
      schema,
      '{"outcome":"maybe"}',
      retry,
    );
    expect(result).toEqual({ outcome: 'correct' });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0]).toMatch(/did not match the required schema/);
  });

  it('throws LlmParseError when the retry also fails', async () => {
    const retry = mockRetry('still not json');
    await expect(parseJsonWithRetry(schema, 'not json', retry)).rejects.toThrow(
      LlmParseError,
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
