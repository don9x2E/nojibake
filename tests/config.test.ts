import { describe, expect, it } from 'vitest';
import { parseConfigText } from '../src/config.js';
import { defaultMaxBytes, resolveMaxBytes } from '../src/scan.js';

describe('config parsing', () => {
  it('allows maxBytes 0 to disable the read limit', () => {
    expect(parseConfigText('{"maxBytes":0}', 'test').maxBytes).toBe(0);
  });

  it('rejects negative maxBytes', () => {
    expect(() => parseConfigText('{"maxBytes":-1}', 'test')).toThrow('maxBytes must be a non-negative integer.');
  });

  it('still requires maxFiles to be a positive integer', () => {
    expect(() => parseConfigText('{"maxFiles":0}', 'test')).toThrow('maxFiles must be a positive integer.');
  });
});

describe('maxBytes resolution', () => {
  it('defaults to 1 MiB when unset', () => {
    expect(resolveMaxBytes(undefined)).toBe(defaultMaxBytes);
  });

  it('treats 0 as unlimited', () => {
    expect(resolveMaxBytes(0)).toBeUndefined();
  });

  it('keeps an explicit positive limit', () => {
    expect(resolveMaxBytes(8)).toBe(8);
  });
});
