import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const cli = join(process.cwd(), 'dist', 'cli.js');
const root = join(process.cwd(), 'tests', 'cli-fixtures');
const configRoot = join(process.cwd(), 'tests', 'config-fixtures');

function runCli(args: string[]): unknown {
  const output = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return JSON.parse(output);
}

function runCliResult(args: string[], input?: string): { status: number | null; stdout: string; stderr: string; json: unknown } {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json: JSON.parse(result.stdout) };
}

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'sample.txt'), 'hello\n');
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0x61, 0x00, 0x62]));
  writeFileSync(join(root, 'mixed-eol.txt'), 'a\r\nb\nc\rd');

  rmSync(configRoot, { recursive: true, force: true });
  mkdirSync(join(configRoot, 'ignored'), { recursive: true });
  writeFileSync(join(configRoot, '.nojibakerc.json'), JSON.stringify({
    maxBytes: 8,
    ignore: ['ignored/**'],
    failOn: ['disallowed-encoding'],
    allowEncodings: ['utf-8', 'ascii']
  }, null, 2));
  writeFileSync(join(configRoot, 'cp949.txt'), Buffer.from([0xb0, 0xa1, 0x0a]));
  writeFileSync(join(configRoot, 'big.txt'), '0123456789');
  writeFileSync(join(configRoot, 'ignored', 'skip.txt'), 'skip\n');
});

describe('CLI JSON behavior', () => {
  it('emits version JSON', () => {
    const result = runCli(['version', '--json']);
    expect(result).toMatchObject({ ok: true, command: 'version' });
  });

  it('runs when invoked through a package-manager bin symlink', () => {
    if (process.platform === 'win32') return;
    const binLink = join(root, 'nojibake-bin');
    rmSync(binLink, { force: true });
    symlinkSync(cli, binLink);
    const output = execFileSync(binLink, ['version', '--json'], { encoding: 'utf8' });
    expect(JSON.parse(output)).toMatchObject({ ok: true, command: 'version' });
  });

  it('emits result schema JSON', () => {
    const result = runCli(['schema', 'result', '--json']);
    expect(result).toMatchObject({ ok: true, command: 'schema result' });
  });

  it('inspects a path as JSON', () => {
    const result = runCli(['inspect', 'path', '--root', root, '--path', 'sample.txt', '--json']);
    expect(result).toMatchObject({ ok: true, command: 'inspect path', data: { safeRewrite: false, length: 6 } });
  });

  it('emits compact inspection JSON for agent contexts', () => {
    const result = runCli(['inspect', 'path', '--root', root, '--path', 'sample.txt', '--json', '--compact']) as { data: Record<string, unknown> };
    expect(result.data).toMatchObject({ p: 'sample.txt', l: 6, e: 'ascii', d: 'ascii', sr: true, sw: false });
    expect(result.data.sha256).toBeUndefined();
  });

  it('scans selected paths compactly', () => {
    const result = runCli(['scan', '--root', root, '--path', 'sample.txt', '--json', '--compact']) as { data: { s: { n: number; safe: number; ok: boolean }; f: Array<{ p: string; sr: boolean }> } };
    expect(result.data.s).toMatchObject({ ok: true, n: 1, safe: 1 });
    expect(result.data.f).toEqual([{ p: 'sample.txt', l: 6, e: 'ascii', d: 'ascii', sr: true, sw: false }]);
  });

  it('reads selected paths from stdin without executing git', () => {
    const result = runCliResult(['scan', '--root', root, '--stdin-paths', '--json', '--compact'], 'sample.txt\nmixed-eol.txt\n');
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ ok: true, command: 'scan', data: { s: { n: 2, mix: 1 } } });
  });

  it('guards unsafe files with standardized reason codes', () => {
    const result = runCliResult(['guard', '--root', root, '--path', 'binary.bin', '--json']);
    expect(result.status).toBe(1);
    expect(result.json).toMatchObject({
      ok: false,
      command: 'guard',
      data: { failures: [{ path: 'binary.bin', policies: ['unsafe'], reasons: ['read:unsafe', 'encoding:binary'] }] }
    });
  });

  it('guards mixed EOL files when that policy is requested', () => {
    const result = runCliResult(['guard', '--root', root, '--path', 'mixed-eol.txt', '--fail-on', 'mixed-eol', '--json', '--compact']);
    expect(result.status).toBe(1);
    expect(result.json).toMatchObject({ ok: false, command: 'guard', data: { fail: [{ p: 'mixed-eol.txt', pol: ['mixed-eol'], why: ['eol:mixed'] }] } });
  });

  it('loads .nojibakerc.json for policy and ignore defaults', () => {
    const guard = runCliResult(['guard', '--root', configRoot, '--path', 'cp949.txt', '--json', '--compact']);
    expect(guard.status).toBe(1);
    expect(guard.json).toMatchObject({ ok: false, data: { fail: [{ p: 'cp949.txt', pol: ['disallowed-encoding'], why: ['encoding:disallowed'] }] } });

    const scan = runCli(['scan', '--root', configRoot, '--json', '--compact']) as { data: { f: Array<{ p: string }>; s: { skip: number } } };
    expect(scan.data.f.map((file) => file.p)).not.toContain('ignored/skip.txt');
    expect(scan.data.s.skip).toBeGreaterThan(0);
  });

  it('uses configured maxBytes before reading large files', () => {
    const result = runCliResult(['guard', '--root', configRoot, '--path', 'big.txt', '--fail-on', 'unsafe', '--json', '--compact']);
    expect(result.status).toBe(1);
    expect(result.json).toMatchObject({ ok: false, data: { fail: [{ p: 'big.txt', pol: ['unsafe'], why: ['large:file', 'read:unsafe'] }] } });
  });

  it('emits pretty scan output for humans', () => {
    const result = spawnSync(process.execPath, [cli, 'scan', '--root', root, '--path', 'sample.txt', '--pretty'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('files: 1');
    expect(result.stdout).toContain('OK\tascii\tascii');
  });

  it('wraps missing --json in a JSON result', () => {
    const result = runCliResult(['version']);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(result.json).toMatchObject({ ok: false, command: 'version', errors: [{ code: 'NOJIBAKE_JSON_REQUIRED' }] });
  });

  it('wraps default --version in a JSON result instead of plaintext', () => {
    const result = runCliResult(['--version']);
    expect(result.status).toBe(2);
    expect(result.stdout.trim().startsWith('{')).toBe(true);
    expect(result.json).toMatchObject({ ok: false, errors: [{ code: 'NOJIBAKE_CLI_USAGE' }] });
  });

  it('wraps missing --path and unknown commands in JSON results', () => {
    const missingPath = runCliResult(['inspect', 'path', '--json']);
    expect(missingPath.status).toBe(2);
    expect(missingPath.json).toMatchObject({ ok: false, command: 'inspect path', errors: [{ code: 'NOJIBAKE_PATH_REQUIRED' }] });

    const unknown = runCliResult(['unknown', '--json']);
    expect(unknown.status).toBe(2);
    expect(unknown.json).toMatchObject({ ok: false, command: 'unknown', errors: [{ code: 'NOJIBAKE_CLI_USAGE' }] });
  });
});
