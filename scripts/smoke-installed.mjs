#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'nojibake-install-smoke-'));
const consumerRoot = join(tempRoot, 'consumer 한글');
let tarballPath = '';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    shell: options.shell === true,
    env: { ...process.env, npm_config_update_notifier: 'false' }
  });
  const expectedStatus = options.status ?? 0;
  if (result.status !== expectedStatus) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      `status: ${result.status}, expected: ${expectedStatus}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`
    ].join('\n'));
  }
  return result.stdout;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${text}`);
  }
}

function assertOkJson(text, command) {
  const parsed = parseJson(text, command);
  if (parsed.ok !== true || parsed.command !== command) {
    throw new Error(`Unexpected ${command} result: ${text}`);
  }
}

function npmCommand(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function powershellCommand() {
  for (const candidate of ['pwsh', 'powershell.exe']) {
    const result = spawnSync(candidate, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  return null;
}

function runInstalledBin(bin, args, options = {}) {
  if (process.platform !== 'win32') return run(bin, args, options);
  return run('cmd.exe', ['/d', '/c', 'call', bin, ...args], options);
}

try {
  mkdirSync(consumerRoot, { recursive: true });
  const packOutput = run(npmCommand('npm'), ['pack', '--silent'], { cwd: projectRoot, shell: process.platform === 'win32' });
  const tarball = packOutput.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (tarball === undefined) throw new Error(`npm pack did not return a tarball name: ${packOutput}`);
  tarballPath = join(projectRoot, tarball);

  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }, null, 2));
  writeFileSync(join(consumerRoot, '한글 파일.txt'), '한글\r\n');
  run(npmCommand('npm'), ['install', tarballPath, '--ignore-scripts'], { cwd: consumerRoot, shell: process.platform === 'win32' });

  const binDir = join(consumerRoot, 'node_modules', '.bin');
  const bin = process.platform === 'win32' ? join(binDir, 'nojibake.cmd') : join(binDir, 'nojibake');
  assertOkJson(runInstalledBin(bin, ['version', '--json'], { cwd: consumerRoot }), 'version');
  assertOkJson(runInstalledBin(bin, ['scan', '--root', consumerRoot, '--stdin-paths', '--json', '--compact'], {
    cwd: consumerRoot,
    input: 'package.json\r\n한글 파일.txt\r\n'
  }), 'scan');

  assertOkJson(run(npmCommand('npx'), ['--no-install', 'nojibake', 'version', '--json'], { cwd: consumerRoot, shell: process.platform === 'win32' }), 'version');

  if (process.platform === 'win32') {
    const ps = powershellCommand();
    if (ps === null) throw new Error('PowerShell was not found on Windows runner.');
    const ps1 = join(binDir, 'nojibake.ps1');
    assertOkJson(run(ps, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, 'version', '--json'], { cwd: consumerRoot }), 'version');
  }

  console.log('installed smoke: pass');
} finally {
  if (tarballPath !== '') rmSync(tarballPath, { force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}
