#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig, type NojibakeConfig } from './config.js';
import { buildInspectData, encodingErrors } from './encoding.js';
import { compactGuardData, compactInspectData, compactScanData, formatGuardLines, formatInspectLine, formatScanLines } from './format.js';
import { resolveSafePath } from './pathSafety.js';
import { envelope, packageInfo } from './result.js';
import { guardScan, parseGuardPolicies, parsePositiveInteger, scanPaths, type ScanOptions } from './scan.js';
import { resultSchema } from './schema.js';
import type { InspectData, VersionData } from './types.js';

interface ScanCliOptions {
  root?: string;
  path?: string[];
  stdinPaths?: boolean;
  maxFiles?: string;
  maxBytes?: string;
  includeIgnored?: boolean;
  ignore?: string[];
  allowEncoding?: string[];
  json?: boolean;
  compact?: boolean;
  pretty?: boolean;
}

interface GuardCliOptions extends ScanCliOptions {
  failOn?: string;
}

function writeJson(value: unknown, compact = false): void {
  process.stdout.write(`${JSON.stringify(value, null, compact ? 0 : 2)}\n`);
}

function writeLines(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

function writeUsageError(command: string, code: string, message: string): void {
  writeJson(envelope({
    ok: false,
    command,
    summary: 'CLI usage error.',
    data: null,
    errors: [{ code, message }]
  }));
  process.exitCode = 2;
}

function requireJsonOption(json: boolean | undefined, command: string): boolean {
  if (json !== true) {
    writeUsageError(command, 'NOJIBAKE_JSON_REQUIRED', 'Pass --json.');
    return false;
  }
  return true;
}

function requireStructuredOutput(options: { json?: boolean; pretty?: boolean }, command: string): 'json' | 'pretty' | null {
  if (options.pretty === true) return 'pretty';
  if (options.json === true) return 'json';
  writeUsageError(command, 'NOJIBAKE_JSON_REQUIRED', 'Pass --json, or pass --pretty for human-readable output.');
  return null;
}

function parseCommand(argv: string[]): string {
  return argv.slice(2).filter((arg) => !arg.startsWith('-')).join(' ');
}

function configureCommand(command: Command): Command {
  return command.helpOption(false).showHelpAfterError(false).showSuggestionAfterError(false);
}

function collectPath(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function readStdinPaths(): string[] {
  if (process.stdin.isTTY === true) return [];
  return readFileSync(0, 'utf8').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function mergeStrings(configValues: string[] | undefined, cliValues: string[] | undefined): string[] | undefined {
  const merged = [...(configValues ?? []), ...(cliValues ?? [])].map((value) => value.trim()).filter(Boolean);
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

function applyNumberOption(target: ScanOptions, key: 'maxFiles' | 'maxBytes', cliValue: string | undefined, configValue: number | undefined): void {
  const parsed = parsePositiveInteger(cliValue);
  const value = parsed ?? configValue;
  if (value !== undefined) target[key] = value;
}

function scanCommandOptions(options: ScanCliOptions): { scanOptions: ScanOptions; config: NojibakeConfig } {
  const root = options.root ?? process.cwd();
  const config = loadConfig(root);
  const scanOptions: ScanOptions = { root };
  const paths = [...(options.path ?? [])];
  const useStdinPaths = options.stdinPaths === true;
  if (useStdinPaths) paths.push(...readStdinPaths());
  if (paths.length > 0) scanOptions.paths = paths;
  if (paths.length > 0 || useStdinPaths) scanOptions.useExplicitPaths = true;
  applyNumberOption(scanOptions, 'maxFiles', options.maxFiles, config.maxFiles);
  applyNumberOption(scanOptions, 'maxBytes', options.maxBytes, config.maxBytes);
  if (options.includeIgnored === true || config.includeIgnored === true) scanOptions.includeIgnored = true;
  const ignore = mergeStrings(config.ignore, options.ignore);
  if (ignore !== undefined) scanOptions.ignore = ignore;
  const allowEncodings = mergeStrings(config.allowEncodings, options.allowEncoding);
  if (allowEncodings !== undefined) scanOptions.allowEncodings = allowEncodings;
  return { scanOptions, config };
}

function runScanCommand(options: ScanCliOptions): void {
  const command = 'scan';
  const output = requireStructuredOutput(options, command);
  if (output === null) return;
  try {
    const { scanOptions } = scanCommandOptions(options);
    const scan = scanPaths(scanOptions);
    if (output === 'pretty') {
      writeLines(formatScanLines(scan));
      return;
    }
    writeJson(envelope({ ok: true, command, summary: `Scanned ${scan.summary.totalFiles} files.`, data: options.compact ? compactScanData(scan) : scan }), options.compact === true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scan failed.';
    writeUsageError(command, 'NOJIBAKE_SCAN_FAILED', message);
  }
}

function runGuardCommand(options: GuardCliOptions): void {
  const command = 'guard';
  const output = requireStructuredOutput(options, command);
  if (output === null) return;
  try {
    const { scanOptions, config } = scanCommandOptions(options);
    const scan = scanPaths(scanOptions);
    const policies = parseGuardPolicies(options.failOn ?? config.failOn);
    const guard = guardScan(scan, policies);
    const ok = guard.failures.length === 0;
    if (output === 'pretty') {
      writeLines(formatGuardLines(guard));
    } else {
      writeJson(envelope({ ok, command, summary: ok ? 'Guard passed.' : `Guard failed for ${guard.failures.length} files.`, data: options.compact ? compactGuardData(guard) : guard }), options.compact === true);
    }
    if (!ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Guard failed.';
    writeUsageError(command, 'NOJIBAKE_GUARD_FAILED', message);
  }
}

export function createProgram(): Command {
  const program = configureCommand(new Command());
  program
    .name('nojibake')
    .description('Read-only text encoding inspection CLI.')
    .exitOverride()
    .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });

  program.action(() => {
    writeUsageError('', 'NOJIBAKE_CLI_USAGE', 'Missing command.');
  });

  configureCommand(program
    .command('version')
    .option('--json', 'emit JSON')
    .action((options: { json?: boolean }) => {
      if (!requireJsonOption(options.json, 'version')) return;
      const data: VersionData = { name: packageInfo.name, version: packageInfo.version };
      writeJson(envelope({ ok: true, command: 'version', summary: `Nojibake ${packageInfo.version}`, data }));
    }));

  const schema = configureCommand(program.command('schema'));
  schema.action(() => {
    writeUsageError('schema', 'NOJIBAKE_CLI_USAGE', 'Missing schema command.');
  });
  configureCommand(schema
    .command('result')
    .option('--json', 'emit JSON')
    .action((options: { json?: boolean }) => {
      if (!requireJsonOption(options.json, 'schema result')) return;
      writeJson(envelope({ ok: true, command: 'schema result', summary: 'Result envelope schema.', data: resultSchema }));
    }));

  const inspect = configureCommand(program.command('inspect'));
  inspect.action(() => {
    writeUsageError('inspect', 'NOJIBAKE_CLI_USAGE', 'Missing inspect command.');
  });
  configureCommand(inspect
    .command('path')
    .option('--root <root>', 'optional root boundary')
    .option('--path <file>', 'file to inspect')
    .option('--json', 'emit JSON')
    .option('--compact', 'emit compact JSON for agent contexts')
    .option('--pretty', 'emit human-readable one-line summary')
    .action((options: { root?: string; path?: string; json?: boolean; compact?: boolean; pretty?: boolean }) => {
      const command = 'inspect path';
      const output = requireStructuredOutput(options, command);
      if (output === null) return;
      if (options.path === undefined) {
        writeUsageError(command, 'NOJIBAKE_PATH_REQUIRED', 'Pass --path <file>.');
        return;
      }
      const safe = resolveSafePath(options.path, options.root);
      if (!safe.ok) {
        writeJson(envelope<InspectData>({ ok: false, command, summary: 'Path rejected.', data: null, errors: safe.errors }), options.compact === true);
        process.exitCode = 2;
        return;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(safe.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'File read failed.';
        writeJson(envelope<InspectData>({
          ok: false,
          command,
          summary: 'File could not be read.',
          data: null,
          errors: [{ code: 'NOJIBAKE_FILE_READ_FAILED', message, details: { path: safe.path } }]
        }), options.compact === true);
        process.exitCode = 2;
        return;
      }
      const data = buildInspectData({ path: safe.path, root: safe.root, bytes });
      const errors = encodingErrors(bytes);
      if (output === 'pretty') {
        writeLines([formatInspectLine(data, errors)]);
      } else {
        writeJson(envelope({
          ok: errors.length === 0,
          command,
          summary: errors.length === 0 ? `Inspected ${data.length} bytes.` : 'File bytes failed encoding validation.',
          data: options.compact === true ? compactInspectData(data) : data,
          errors
        }), options.compact === true);
      }
      if (errors.length > 0) process.exitCode = 1;
    }));

  configureCommand(program
    .command('scan')
    .option('--root <root>', 'root directory to scan', process.cwd())
    .option('--path <file>', 'specific file to scan; can be repeated', collectPath, [] as string[])
    .option('--stdin-paths', 'read newline-separated paths from stdin')
    .option('--max-files <n>', 'maximum files for recursive scan')
    .option('--max-bytes <n>', 'maximum bytes to read per file')
    .option('--include-ignored', 'include default ignored directories such as node_modules and dist')
    .option('--ignore <pattern>', 'ignore pattern; can be repeated', collectPath, [] as string[])
    .option('--allow-encoding <encoding>', 'allowed encoding; can be repeated', collectPath, [] as string[])
    .option('--json', 'emit JSON')
    .option('--compact', 'emit compact JSON for agent contexts')
    .option('--pretty', 'emit human-readable summary')
    .action(runScanCommand));

  configureCommand(program
    .command('guard')
    .option('--root <root>', 'root directory to scan', process.cwd())
    .option('--path <file>', 'specific file to guard; can be repeated', collectPath, [] as string[])
    .option('--stdin-paths', 'read newline-separated paths from stdin')
    .option('--max-files <n>', 'maximum files for recursive scan')
    .option('--max-bytes <n>', 'maximum bytes to read per file')
    .option('--include-ignored', 'include default ignored directories such as node_modules and dist')
    .option('--ignore <pattern>', 'ignore pattern; can be repeated', collectPath, [] as string[])
    .option('--allow-encoding <encoding>', 'allowed encoding; can be repeated', collectPath, [] as string[])
    .option('--fail-on <policies>', 'comma-separated policies: unsafe,ambiguous,mixed-eol,non-utf8,disallowed-encoding')
    .option('--json', 'emit JSON')
    .option('--compact', 'emit compact JSON for agent contexts')
    .option('--pretty', 'emit human-readable summary')
    .action(runGuardCommand));

  return program;
}

export function run(argv: string[] = process.argv): void {
  try {
    createProgram().parse(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLI parse failed.';
    writeUsageError(parseCommand(argv), 'NOJIBAKE_CLI_USAGE', message);
  }
}

function isDirectCliInvocation(argv: string[] = process.argv): boolean {
  const argvPath = argv[1];
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argvPath);
  } catch {
    return import.meta.url === `file://${argvPath.replace(/\\/g, '/')}` || argvPath.endsWith('cli.js');
  }
}

if (isDirectCliInvocation()) {
  run();
}
