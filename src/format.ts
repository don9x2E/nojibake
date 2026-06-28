import { relative, sep } from 'node:path';
import type { GuardData, InspectData, ResultError, ScanData, ScanFileData, ScanSummaryData } from './types.js';

function portable(path: string): string {
  return path.split(sep).join('/');
}

function displayInspectPath(data: InspectData): string {
  if (data.root === null) return data.path;
  const rel = relative(data.root, data.path);
  return rel === '' ? '.' : portable(rel);
}

export function compactInspectData(data: InspectData): Record<string, unknown> {
  return {
    p: displayInspectPath(data),
    l: data.length,
    h: data.sha256,
    bom: data.bom,
    e: data.encoding,
    d: data.decision,
    sr: data.safeRead,
    sw: data.safeRewrite,
    mix: data.eol.mixed
  };
}

function compactSummary(summary: ScanSummaryData): Record<string, unknown> {
  return {
    ok: summary.ok,
    n: summary.totalFiles,
    bytes: summary.totalBytes,
    safe: summary.safeRead,
    unsafe: summary.unsafeRead,
    amb: summary.ambiguous,
    mix: summary.mixedEol,
    err: summary.errorFiles,
    skip: summary.skipped,
    d: summary.byDecision,
    e: summary.byEncoding,
    why: summary.byReason
  };
}

function compactFile(file: ScanFileData): Record<string, unknown> {
  const output: Record<string, unknown> = {
    p: file.path,
    l: file.length,
    e: file.encoding,
    d: file.decision,
    sr: file.safeRead,
    sw: file.safeRewrite
  };
  if (file.eol?.mixed === true) output.mix = true;
  if (file.reasons.length > 0) output.why = file.reasons;
  if (file.errors.length > 0) output.err = file.errors.map((error) => error.code);
  return output;
}

export function compactScanData(data: ScanData): Record<string, unknown> {
  return { r: data.root, s: compactSummary(data.summary), f: data.files.map(compactFile) };
}

export function compactGuardData(data: GuardData): Record<string, unknown> {
  return {
    r: data.root,
    p: data.policies,
    s: compactSummary(data.summary),
    fail: data.failures.map((failure) => ({ p: failure.path, pol: failure.policies, why: failure.reasons }))
  };
}

export function formatInspectLine(data: InspectData, errors: ResultError[]): string {
  const status = errors.length === 0 && data.safeRead ? 'OK' : 'RISK';
  const eol = data.eol.mixed ? 'mixed-eol' : 'stable-eol';
  return `${status}\t${data.encoding}\t${data.decision}\t${data.length}B\t${eol}\t${displayInspectPath(data)}`;
}

export function formatScanLines(data: ScanData): string[] {
  const lines = [
    `root: ${data.root}`,
    `files: ${data.summary.totalFiles}, safe: ${data.summary.safeRead}, unsafe: ${data.summary.unsafeRead}, ambiguous: ${data.summary.ambiguous}, mixed-eol: ${data.summary.mixedEol}, skipped: ${data.summary.skipped}, bytes: ${data.summary.totalBytes}`
  ];
  for (const file of data.files) {
    const status = file.errors.length === 0 && file.safeRead ? 'OK' : 'RISK';
    const reasons = file.reasons.length > 0 ? `\t${file.reasons.join(',')}` : '';
    lines.push(`${status}\t${file.encoding ?? 'unknown'}\t${file.decision}\t${file.length ?? 0}B\t${file.path}${reasons}`);
  }
  return lines;
}

export function formatGuardLines(data: GuardData): string[] {
  const lines = [
    `root: ${data.root}`,
    `policies: ${data.policies.join(',')}`,
    `failures: ${data.failures.length}`
  ];
  for (const failure of data.failures) {
    lines.push(`FAIL\t${failure.policies.join(',')}\t${failure.reasons.join(',')}\t${failure.path}`);
  }
  return lines;
}
