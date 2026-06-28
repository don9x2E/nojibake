import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { buildInspectData, encodingErrors } from './encoding.js';
import { resolveSafePath } from './pathSafety.js';
import { makeError } from './result.js';
import type { GuardData, GuardFailureData, GuardPolicy, ReasonCode, ScanData, ScanFileData, ScanSkippedData, ScanSummaryData } from './types.js';

const defaultIgnoredDirs = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const allowedPolicies = new Set<GuardPolicy>(['unsafe', 'ambiguous', 'mixed-eol', 'non-utf8', 'disallowed-encoding']);

export interface ScanOptions {
  root?: string;
  paths?: string[];
  useExplicitPaths?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  includeIgnored?: boolean;
  ignore?: string[];
  allowEncodings?: string[];
}

function portable(path: string): string {
  return path.split(sep).join('/');
}

function relativeToRoot(root: string, path: string): string {
  const rel = relative(root, path);
  return rel === '' ? '.' : portable(rel);
}

function emptySummary(skipped: number): ScanSummaryData {
  return {
    ok: true,
    totalFiles: 0,
    totalBytes: 0,
    safeRead: 0,
    unsafeRead: 0,
    safeRewrite: 0,
    ambiguous: 0,
    mixedEol: 0,
    errorFiles: 0,
    skipped,
    byDecision: {},
    byEncoding: {},
    byReason: {}
  };
}

function addCount(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function summarize(files: ScanFileData[], skipped: ScanSkippedData[]): ScanSummaryData {
  const summary = emptySummary(skipped.length);
  for (const file of files) {
    summary.totalFiles += 1;
    summary.totalBytes += file.length ?? 0;
    if (file.safeRead && file.errors.length === 0) {
      summary.safeRead += 1;
    } else {
      summary.unsafeRead += 1;
    }
    if (file.safeRewrite) summary.safeRewrite += 1;
    if (file.decision === 'ambiguous') summary.ambiguous += 1;
    if (file.eol?.mixed === true) summary.mixedEol += 1;
    if (file.errors.length > 0) summary.errorFiles += 1;
    addCount(summary.byDecision, file.decision);
    addCount(summary.byEncoding, file.encoding ?? 'unknown');
    for (const reason of file.reasons) addCount(summary.byReason, reason);
  }
  summary.ok = summary.unsafeRead === 0;
  return summary;
}

function normalizeIgnorePattern(pattern: string): string {
  return pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function escapeRegexChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

function globToRegex(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else {
      source += escapeRegexChar(char ?? '');
    }
  }
  return new RegExp(`${source}$`);
}

function isIgnored(path: string, patterns: string[]): boolean {
  const normalizedPath = normalizeIgnorePattern(path);
  return patterns.some((rawPattern) => {
    const pattern = normalizeIgnorePattern(rawPattern);
    if (pattern === '') return false;
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
    }
    if (!pattern.includes('*')) {
      return normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`);
    }
    return globToRegex(pattern).test(normalizedPath);
  });
}

function collectRecursive(root: string, maxFiles: number, includeIgnored: boolean, ignore: string[]): { paths: string[]; skipped: ScanSkippedData[] } {
  const paths: string[] = [];
  const skipped: ScanSkippedData[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);
      const relPath = relativeToRoot(root, fullPath);
      if (isIgnored(relPath, ignore)) {
        skipped.push({ path: relPath, reason: 'ignored-path' });
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped.push({ path: relPath, reason: 'symlink' });
        continue;
      }
      if (entry.isDirectory()) {
        if (!includeIgnored && defaultIgnoredDirs.has(entry.name)) {
          skipped.push({ path: relPath, reason: 'ignored-directory' });
          continue;
        }
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        skipped.push({ path: relPath, reason: 'not-regular-file' });
        continue;
      }
      if (paths.length >= maxFiles) {
        skipped.push({ path: relPath, reason: 'max-files-exceeded' });
        continue;
      }
      paths.push(relPath);
    }
  }

  return { paths: paths.sort(), skipped: skipped.sort((a, b) => a.path.localeCompare(b.path)) };
}

function uniqueReasons(reasons: ReasonCode[]): ReasonCode[] {
  return [...new Set(reasons)];
}

function reasonCodesFor(file: ScanFileData, allowEncodings: Set<string> | null): ReasonCode[] {
  const reasons: ReasonCode[] = [];
  if (file.errors.some((error) => error.code.startsWith('NOJIBAKE_PATH_'))) reasons.push('path:error');
  if (file.errors.some((error) => error.code === 'NOJIBAKE_FILE_READ_FAILED')) reasons.push('file:read-failed');
  if (file.errors.some((error) => error.code === 'NOJIBAKE_FILE_TOO_LARGE')) reasons.push('large:file');
  if (!file.safeRead || file.errors.length > 0) reasons.push('read:unsafe');
  if (file.decision === 'binary' || file.errors.some((error) => error.code === 'NOJIBAKE_BINARY_NUL')) reasons.push('encoding:binary');
  if (file.decision === 'invalid') reasons.push('encoding:invalid');
  if (file.decision === 'ambiguous') reasons.push('encoding:ambiguous');
  if (file.encoding !== null && file.encoding !== 'utf-8' && file.encoding !== 'ascii') reasons.push('encoding:non-utf8');
  if (allowEncodings !== null && file.encoding !== null && !allowEncodings.has(file.encoding)) reasons.push('encoding:disallowed');
  if (file.eol?.mixed === true) reasons.push('eol:mixed');
  return uniqueReasons(reasons);
}

function withReasons(file: Omit<ScanFileData, 'reasons'>, allowEncodings: Set<string> | null): ScanFileData {
  const complete: ScanFileData = { ...file, reasons: [] };
  return { ...complete, reasons: reasonCodesFor(complete, allowEncodings) };
}

function inspectOne(root: string, inputPath: string, options: { maxBytes?: number; allowEncodings: Set<string> | null }): ScanFileData {
  const safe = resolveSafePath(inputPath, root);
  const displayPath = safe.root === null ? safe.path : relativeToRoot(safe.root, safe.path);
  if (!safe.ok) {
    return withReasons({
      path: displayPath,
      ok: false,
      length: null,
      sha256: null,
      bom: null,
      encoding: null,
      decision: 'error',
      asciiCompatible: null,
      eol: null,
      safeRead: false,
      safeRewrite: false,
      candidates: [],
      errors: safe.errors
    }, options.allowEncodings);
  }

  const fileSize = statSync(safe.path).size;
  if (options.maxBytes !== undefined && fileSize > options.maxBytes) {
    return withReasons({
      path: displayPath,
      ok: false,
      length: fileSize,
      sha256: null,
      bom: null,
      encoding: null,
      decision: 'error',
      asciiCompatible: null,
      eol: null,
      safeRead: false,
      safeRewrite: false,
      candidates: [],
      errors: [makeError('NOJIBAKE_FILE_TOO_LARGE', 'File exceeds maxBytes and was not read.', { path: displayPath, length: fileSize, maxBytes: options.maxBytes })]
    }, options.allowEncodings);
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(safe.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'File read failed.';
    return withReasons({
      path: displayPath,
      ok: false,
      length: null,
      sha256: null,
      bom: null,
      encoding: null,
      decision: 'error',
      asciiCompatible: null,
      eol: null,
      safeRead: false,
      safeRewrite: false,
      candidates: [],
      errors: [makeError('NOJIBAKE_FILE_READ_FAILED', message, { path: displayPath })]
    }, options.allowEncodings);
  }

  const data = buildInspectData({ path: safe.path, root: safe.root, bytes });
  const errors = encodingErrors(bytes);
  return withReasons({
    path: displayPath,
    ok: errors.length === 0,
    length: data.length,
    sha256: data.sha256,
    bom: data.bom,
    encoding: data.encoding,
    decision: data.decision,
    asciiCompatible: data.asciiCompatible,
    eol: data.eol,
    safeRead: data.safeRead,
    safeRewrite: data.safeRewrite,
    candidates: data.candidates,
    errors
  }, options.allowEncodings);
}

function normalizeInputPaths(paths: string[] | undefined): string[] {
  return [...new Set((paths ?? []).flatMap((value) => value.split(/\r?\n/)).map((value) => value.trim()).filter(Boolean))];
}

export function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return parsed;
}

export function parseMaxFiles(value: string | undefined, fallback = 5000): number {
  return parsePositiveInteger(value) ?? fallback;
}

export function scanPaths(options: ScanOptions = {}): ScanData {
  const root = resolve(options.root ?? process.cwd());
  const rootStat = statSync(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Scan root is not a directory: ${root}`);
  }

  const ignore = (options.ignore ?? []).map(normalizeIgnorePattern).filter(Boolean);
  const inputPaths = normalizeInputPaths(options.paths);
  const skippedInputs: ScanSkippedData[] = [];
  const activeInputPaths = inputPaths.filter((path) => {
    if (!isIgnored(path, ignore)) return true;
    skippedInputs.push({ path: normalizeIgnorePattern(path), reason: 'ignored-path' });
    return false;
  });
  const useExplicitPaths = options.useExplicitPaths === true || activeInputPaths.length > 0;
  const collected = useExplicitPaths
    ? { paths: activeInputPaths, skipped: skippedInputs }
    : collectRecursive(root, options.maxFiles ?? 5000, options.includeIgnored === true, ignore);
  const allowEncodings = options.allowEncodings === undefined ? null : new Set(options.allowEncodings.map((encoding) => encoding.toLowerCase()));
  const inspectOptions: { maxBytes?: number; allowEncodings: Set<string> | null } = { allowEncodings };
  if (options.maxBytes !== undefined) inspectOptions.maxBytes = options.maxBytes;
  const files = collected.paths.map((path) => inspectOne(root, path, inspectOptions));
  return { root: portable(root), files, skipped: collected.skipped, summary: summarize(files, collected.skipped) };
}

function policyReasons(policy: GuardPolicy, file: ScanFileData): ReasonCode[] {
  if (policy === 'unsafe') return file.reasons.filter((reason) => ['path:error', 'file:read-failed', 'large:file', 'read:unsafe', 'encoding:binary', 'encoding:invalid'].includes(reason));
  if (policy === 'ambiguous' && file.reasons.includes('encoding:ambiguous')) return ['encoding:ambiguous'];
  if (policy === 'mixed-eol' && file.reasons.includes('eol:mixed')) return ['eol:mixed'];
  if (policy === 'non-utf8' && file.reasons.includes('encoding:non-utf8')) return ['encoding:non-utf8'];
  if (policy === 'disallowed-encoding' && file.reasons.includes('encoding:disallowed')) return ['encoding:disallowed'];
  return [];
}

export function parseGuardPolicies(value: string | GuardPolicy[] | undefined): GuardPolicy[] {
  const raw = Array.isArray(value) ? value : value === undefined ? ['unsafe'] : value.split(',').map((item) => item.trim()).filter(Boolean);
  const policies: GuardPolicy[] = [];
  for (const item of raw) {
    if (!allowedPolicies.has(item as GuardPolicy)) {
      throw new Error(`Unknown guard policy: ${item}`);
    }
    policies.push(item as GuardPolicy);
  }
  return policies.length > 0 ? [...new Set(policies)] : ['unsafe'];
}

export function guardScan(scan: ScanData, policies: GuardPolicy[]): GuardData {
  const failures: GuardFailureData[] = [];
  for (const file of scan.files) {
    const matchedPolicies = policies.filter((policy) => policyReasons(policy, file).length > 0);
    const reasons = uniqueReasons(matchedPolicies.flatMap((policy) => policyReasons(policy, file)));
    if (matchedPolicies.length > 0) failures.push({ path: file.path, policies: matchedPolicies, reasons });
  }
  return { root: scan.root, policies, summary: scan.summary, failures };
}
