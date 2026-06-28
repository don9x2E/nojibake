import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { beforeAll, describe, expect, it } from 'vitest';

const cli = join(process.cwd(), 'dist', 'cli.js');
const root = join(process.cwd(), 'tests', 'windows-fixtures');

function runCli(args: string[]): unknown {
  const output = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return JSON.parse(output);
}

function runCliResult(args: string[], input?: string): { status: number | null; stdout: string; json: unknown } {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input });
  return { status: result.status, stdout: result.stdout, json: JSON.parse(result.stdout) };
}

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '한글 파일.txt'), '한글\r\n');
  writeFileSync(join(root, 'legacy-cp949-가.txt'), iconv.encode('가\r\n', 'windows-949'));
  writeFileSync(join(root, 'resource.rc'), Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('STRINGTABLE\r\nBEGIN\r\n  IDS_APP_TITLE "한글"\r\nEND\r\n', 'utf16le')
  ]));
  writeFileSync(join(root, 'mixed-eol.txt'), 'a\r\nb\nc\rd');
});

describe('Windows and CJK preflight behavior', () => {
  it('preserves Hangul file names in compact JSON', () => {
    const result = runCli(['inspect', 'path', '--root', root, '--path', '한글 파일.txt', '--json', '--compact']) as { ok: boolean; data: { p: string; sr: boolean } };
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ p: '한글 파일.txt', sr: true });
  });

  it('scans CP949, UTF-16LE resource files, and mixed CRLF/LF inputs', () => {
    const result = runCli(['scan', '--root', root, '--path', '한글 파일.txt', '--path', 'legacy-cp949-가.txt', '--path', 'resource.rc', '--path', 'mixed-eol.txt', '--json', '--compact']) as {
      data: { s: { n: number; mix: number; e: Record<string, number> }; f: Array<{ p: string }> };
    };
    expect(result.data.s.n).toBe(4);
    expect(result.data.s.e['windows-949']).toBe(1);
    expect(result.data.s.e['utf-16le']).toBe(1);
    expect(result.data.s.mix).toBe(1);
    expect(result.data.f.map((file) => file.p)).toContain('legacy-cp949-가.txt');
  });

  it('accepts CRLF stdin path lists like Windows shells produce', () => {
    const result = runCliResult(['scan', '--root', root, '--stdin-paths', '--json', '--compact'], '한글 파일.txt\r\nresource.rc\r\n') as { status: number | null; json: { data: { s: { n: number } } } };
    expect(result.status).toBe(0);
    expect(result.json.data.s.n).toBe(2);
  });

  it('rejects Windows alternate data stream notation even for CJK paths', () => {
    const result = runCliResult(['inspect', 'path', '--root', root, '--path', '한글 파일.txt:stream', '--json']) as { status: number | null; json: { errors: Array<{ code: string }> } };
    expect(result.status).toBe(2);
    expect(result.json.errors.some((error) => error.code === 'NOJIBAKE_PATH_ADS_REJECTED')).toBe(true);
  });
});
