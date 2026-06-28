#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(projectRoot, 'dist', 'cli.js');
const root = mkdtempSync(join(tmpdir(), 'nojibake-windows-cjk-'));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    input: options.input,
    encoding: 'utf8'
  });
  const expectedStatus = options.status ?? 0;
  if (result.status !== expectedStatus) {
    throw new Error([
      `Command failed: node dist/cli.js ${args.join(' ')}`,
      `status: ${result.status}, expected: ${expectedStatus}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`
    ].join('\n'));
  }
  return JSON.parse(result.stdout);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '한글 파일.txt'), '한글\r\n');
  writeFileSync(join(root, 'legacy-cp949-가.txt'), iconv.encode('가\r\n', 'windows-949'));
  writeFileSync(join(root, 'resource.rc'), Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('STRINGTABLE\r\nBEGIN\r\n  IDS_APP_TITLE "한글"\r\nEND\r\n', 'utf16le')
  ]));
  writeFileSync(join(root, 'mixed-eol.txt'), 'a\r\nb\nc\rd');

  const inspect = run(['inspect', 'path', '--root', root, '--path', '한글 파일.txt', '--json', '--compact']);
  expect(inspect.ok === true, 'Hangul path inspection should succeed.');
  expect(inspect.data.p === '한글 파일.txt', 'Hangul path should be preserved in compact JSON.');

  const scan = run(['scan', '--root', root, '--path', '한글 파일.txt', '--path', 'legacy-cp949-가.txt', '--path', 'resource.rc', '--path', 'mixed-eol.txt', '--json', '--compact']);
  expect(scan.ok === true, 'CJK/Windows fixture scan should return ok envelope.');
  expect(scan.data.s.n === 4, 'Expected four scanned files.');
  expect(scan.data.s.e['windows-949'] === 1, 'Expected one windows-949 file.');
  expect(scan.data.s.e['utf-16le'] === 1, 'Expected one UTF-16LE file.');
  expect(scan.data.s.mix === 1, 'Expected one mixed-EOL file.');

  const stdinScan = run(['scan', '--root', root, '--stdin-paths', '--json', '--compact'], { input: '한글 파일.txt\r\nresource.rc\r\n' });
  expect(stdinScan.data.s.n === 2, 'CRLF stdin path list should scan two files.');

  const disallowed = run(['guard', '--root', root, '--path', 'legacy-cp949-가.txt', '--allow-encoding', 'utf-8', '--allow-encoding', 'ascii', '--fail-on', 'disallowed-encoding', '--json', '--compact'], { status: 1 });
  expect(disallowed.ok === false, 'Disallowed windows-949 guard should fail.');
  expect(disallowed.data.fail[0].why.includes('encoding:disallowed'), 'Disallowed guard should report encoding:disallowed.');

  const mixed = run(['guard', '--root', root, '--path', 'mixed-eol.txt', '--fail-on', 'mixed-eol', '--json', '--compact'], { status: 1 });
  expect(mixed.data.fail[0].why.includes('eol:mixed'), 'Mixed EOL guard should report eol:mixed.');

  const ads = run(['inspect', 'path', '--root', root, '--path', '한글 파일.txt:stream', '--json'], { status: 2 });
  expect(ads.errors.some((error) => error.code === 'NOJIBAKE_PATH_ADS_REJECTED'), 'ADS-shaped path should be rejected.');

  console.log(`windows/cjk smoke: pass (${process.platform})`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
