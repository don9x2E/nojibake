import { describe, expect, it } from 'vitest';
import { envelope } from '../src/result.js';
import { resultSchema } from '../src/schema.js';

describe('result schema', () => {
  it('matches the JSON-first envelope shape', () => {
    const result = envelope({ ok: true, command: 'test', summary: 'ok', data: { value: 1 } });
    expect(Object.keys(result)).toEqual(['schemaVersion', 'toolVersion', 'invocationId', 'ok', 'command', 'summary', 'data', 'errors', 'warnings']);
    expect(resultSchema.required).toEqual(Object.keys(result));
  });
});
