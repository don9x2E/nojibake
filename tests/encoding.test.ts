import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeBytes, buildInspectData, sha256 } from '../src/encoding.js';

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures');

function fixture(name: string): string {
  return join(fixtureRoot, name);
}

function writeFixture(name: string, bytes: Buffer): void {
  writeFileSync(fixture(name), bytes);
}

beforeAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(fixtureRoot, { recursive: true });
  writeFixture('utf8-bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello\n©\n', 'utf8')]));
  writeFixture('utf8.txt', Buffer.from('hello\n©\n', 'utf8'));
  writeFixture('invalid-utf8.bin', Buffer.from([0xc3, 0x28]));
  writeFixture('utf16le.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('A\n', 'utf16le')]));
  writeFixture('utf16be.txt', Buffer.from([0xfe, 0xff, 0x00, 0x41, 0x00, 0x0a]));
  writeFixture('utf16le-truncated.txt', Buffer.from([0xff, 0xfe, 0x41]));
  writeFixture('utf16be-truncated.txt', Buffer.from([0xfe, 0xff, 0x00]));
  writeFixture('ascii.txt', Buffer.from('a\r\nb\nc\rd', 'ascii'));
  writeFixture('binary-nul.bin', Buffer.from([0x61, 0x00, 0x62]));
  writeFixture('cp949.txt', iconv.encode('가\r\n', 'windows-949'));
  writeFixture('invalid-cp949.bin', Buffer.from([0x81, 0x30]));
  writeFixture('ambiguous.bin', Buffer.from([0xc2, 0xa9]));
});

describe('encoding analysis', () => {
  it('detects UTF-8 BOM and validates text', () => {
    const result = analyzeBytes(readFileSync(fixture('utf8-bom.txt')));
    expect(result.bom).toBe('utf-8');
    expect(result.decision).toBe('confirmed');
    expect(result.safeRead).toBe(true);
  });

  it('detects UTF-8 without BOM as an ambiguous non-ASCII candidate when CP949 also round-trips', () => {
    const result = analyzeBytes(readFileSync(fixture('utf8.txt')));
    expect(result.bom).toBe('none');
    expect(result.decision).toBe('ambiguous');
    expect(result.candidates.filter((candidate) => candidate.valid).map((candidate) => candidate.encoding)).toEqual(['utf-8', 'windows-949']);
  });

  it('reports invalid UTF-8 bytes with structured offsets when no candidate is valid', () => {
    const result = analyzeBytes(readFileSync(fixture('invalid-cp949.bin')));
    expect(result.decision).toBe('invalid');
    expect(result.errors[0]?.code).toBe('NOJIBAKE_INVALID_BYTES');
    expect(result.errors[0]?.details?.utf8InvalidOffset).toBe(0);
  });

  it('validates UTF-16 LE and BE BOM files', () => {
    expect(analyzeBytes(readFileSync(fixture('utf16le.txt'))).encoding).toBe('utf-16le');
    expect(analyzeBytes(readFileSync(fixture('utf16be.txt'))).encoding).toBe('utf-16be');
  });

  it('rejects truncated UTF-16 LE and BE payloads', () => {
    expect(analyzeBytes(readFileSync(fixture('utf16le-truncated.txt'))).errors[0]?.code).toBe('NOJIBAKE_INVALID_UTF16_TRUNCATED');
    expect(analyzeBytes(readFileSync(fixture('utf16be-truncated.txt'))).errors[0]?.code).toBe('NOJIBAKE_INVALID_UTF16_TRUNCATED');
  });

  it('classifies ASCII and summarizes mixed line endings', () => {
    const result = analyzeBytes(readFileSync(fixture('ascii.txt')));
    expect(result.decision).toBe('ascii');
    expect(result.eol).toMatchObject({ crlf: 1, lf: 1, cr: 1, mixed: true, finalNewline: false });
  });

  it('detects binary NUL bytes', () => {
    const result = analyzeBytes(readFileSync(fixture('binary-nul.bin')));
    expect(result.decision).toBe('binary');
    expect(result.errors[0]?.code).toBe('NOJIBAKE_BINARY_NUL');
  });

  it('classifies valid CP949 bytes as windows-949', () => {
    const result = analyzeBytes(readFileSync(fixture('cp949.txt')));
    expect(result.encoding).toBe('windows-949');
    expect(result.safeRead).toBe(true);
  });

  it('flags bytes valid as both UTF-8 and windows-949 as ambiguous', () => {
    const result = analyzeBytes(readFileSync(fixture('ambiguous.bin')));
    expect(result.decision).toBe('ambiguous');
  });

  it('builds read-only inspection data with stable hashing', () => {
    const bytes = readFileSync(fixture('ascii.txt'));
    const data = buildInspectData({ path: fixture('ascii.txt'), root: fixtureRoot, bytes });
    expect(data.sha256).toBe(sha256(bytes));
    expect(data.safeRewrite).toBe(false);
  });
});
