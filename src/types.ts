export const schemaVersion = '1.0.0';

export interface ResultError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResultEnvelope<TData> {
  schemaVersion: string;
  toolVersion: string;
  invocationId: string;
  ok: boolean;
  command: string;
  summary: string;
  data: TData | null;
  errors: ResultError[];
  warnings: ResultError[];
}

export interface EolSummary {
  crlf: number;
  lf: number;
  cr: number;
  mixed: boolean;
  finalNewline: boolean;
}

export interface EncodingCandidate {
  encoding: string;
  valid: boolean;
  confidence: 'confirmed' | 'candidate';
}

export interface InspectData {
  path: string;
  root: string | null;
  length: number;
  sha256: string;
  bom: 'none' | 'utf-8' | 'utf-16le' | 'utf-16be';
  encoding: string;
  decision: 'binary' | 'confirmed' | 'ascii' | 'candidate' | 'ambiguous' | 'invalid';
  asciiCompatible: boolean;
  eol: EolSummary;
  safeRead: boolean;
  safeRewrite: false;
  candidates: EncodingCandidate[];
}

export interface VersionData {
  name: string;
  version: string;
}

export type ReasonCode =
  | 'path:error'
  | 'file:read-failed'
  | 'large:file'
  | 'read:unsafe'
  | 'encoding:binary'
  | 'encoding:invalid'
  | 'encoding:ambiguous'
  | 'encoding:non-utf8'
  | 'encoding:disallowed'
  | 'eol:mixed';

export interface ScanFileData {
  path: string;
  ok: boolean;
  length: number | null;
  sha256: string | null;
  bom: InspectData['bom'] | null;
  encoding: string | null;
  decision: InspectData['decision'] | 'error';
  asciiCompatible: boolean | null;
  eol: EolSummary | null;
  safeRead: boolean;
  safeRewrite: false;
  candidates: EncodingCandidate[];
  reasons: ReasonCode[];
  errors: ResultError[];
}

export interface ScanSkippedData {
  path: string;
  reason: string;
}

export interface ScanSummaryData {
  ok: boolean;
  totalFiles: number;
  totalBytes: number;
  safeRead: number;
  unsafeRead: number;
  safeRewrite: number;
  ambiguous: number;
  mixedEol: number;
  errorFiles: number;
  skipped: number;
  byDecision: Record<string, number>;
  byEncoding: Record<string, number>;
  byReason: Record<string, number>;
}

export interface ScanData {
  root: string;
  files: ScanFileData[];
  skipped: ScanSkippedData[];
  summary: ScanSummaryData;
}

export type GuardPolicy = 'unsafe' | 'ambiguous' | 'mixed-eol' | 'non-utf8' | 'disallowed-encoding';

export interface GuardFailureData {
  path: string;
  policies: GuardPolicy[];
  reasons: ReasonCode[];
}

export interface GuardData {
  root: string;
  policies: GuardPolicy[];
  summary: ScanSummaryData;
  failures: GuardFailureData[];
}
