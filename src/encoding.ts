import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import iconv from 'iconv-lite';
import { makeError } from './result.js';
import type { EncodingCandidate, EolSummary, InspectData, ResultError } from './types.js';

type Bom = InspectData['bom'];
type UnicodeEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

interface EncodingDecision {
  bom: Bom;
  encoding: string;
  decision: InspectData['decision'];
  asciiCompatible: boolean;
  safeRead: boolean;
  eol: EolSummary;
  candidates: EncodingCandidate[];
  errors: ResultError[];
}

function hasPrefix(bytes: Buffer, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function detectBom(bytes: Buffer): { bom: Bom; offset: number; encoding: UnicodeEncoding | null } {
  if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) return { bom: 'utf-8', offset: 3, encoding: 'utf-8' };
  if (hasPrefix(bytes, [0xff, 0xfe])) return { bom: 'utf-16le', offset: 2, encoding: 'utf-16le' };
  if (hasPrefix(bytes, [0xfe, 0xff])) return { bom: 'utf-16be', offset: 2, encoding: 'utf-16be' };
  return { bom: 'none', offset: 0, encoding: null };
}

function strictDecode(bytes: Buffer, encoding: UnicodeEncoding): string {
  return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
}

function firstInvalidUtf8Offset(bytes: Buffer): number {
  for (let i = 0; i < bytes.length; i += 1) {
    const value = bytes[i];
    if (value === undefined) return i;
    if (value <= 0x7f) continue;
    let needed = 0;
    let min = 0;
    if (value >= 0xc2 && value <= 0xdf) {
      needed = 1;
      min = 0x80;
    } else if (value >= 0xe0 && value <= 0xef) {
      needed = 2;
      min = value === 0xe0 ? 0xa0 : 0x80;
    } else if (value >= 0xf0 && value <= 0xf4) {
      needed = 3;
      min = value === 0xf0 ? 0x90 : 0x80;
    } else {
      return i;
    }
    if (i + needed >= bytes.length) return i;
    const firstContinuation = bytes[i + 1];
    if (firstContinuation === undefined || firstContinuation < min || firstContinuation > 0xbf) return i + 1;
    for (let j = 2; j <= needed; j += 1) {
      const continuation = bytes[i + j];
      if (continuation === undefined || continuation < 0x80 || continuation > 0xbf) return i + j;
    }
    if (value === 0xed) {
      const second = bytes[i + 1];
      if (second !== undefined && second >= 0xa0) return i;
    }
    if (value === 0xf4) {
      const second = bytes[i + 1];
      if (second !== undefined && second > 0x8f) return i;
    }
    i += needed;
  }
  return -1;
}

function isCp949RoundTrip(bytes: Buffer): boolean {
  const decoded = iconv.decode(bytes, 'windows-949');
  if (decoded.includes('\ufffd')) return false;
  return iconv.encode(decoded, 'windows-949').equals(bytes);
}

function makeEolSummary(text: string): EolSummary {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\r') {
      if (text[i + 1] === '\n') {
        crlf += 1;
        i += 1;
      } else {
        cr += 1;
      }
    } else if (char === '\n') {
      lf += 1;
    }
  }
  const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
  return { crlf, lf, cr, mixed: kinds > 1, finalNewline: text.endsWith('\n') || text.endsWith('\r') };
}

function emptyEol(): EolSummary {
  return { crlf: 0, lf: 0, cr: 0, mixed: false, finalNewline: false };
}

function isAscii(bytes: Buffer): boolean {
  return bytes.every((byte) => byte <= 0x7f);
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function analyzeBytes(bytes: Buffer): EncodingDecision {
  const bom = detectBom(bytes);
  const payload = bytes.subarray(bom.offset);
  const nulOffset = bytes.indexOf(0x00);
  if (nulOffset >= 0 && bom.encoding === null) {
    return {
      bom: bom.bom,
      encoding: 'binary',
      decision: 'binary',
      asciiCompatible: false,
      safeRead: false,
      eol: emptyEol(),
      candidates: [],
      errors: [makeError('NOJIBAKE_BINARY_NUL', 'Binary NUL byte detected.', { offset: nulOffset })]
    };
  }

  if (bom.encoding !== null) {
    if ((bom.encoding === 'utf-16le' || bom.encoding === 'utf-16be') && payload.length % 2 !== 0) {
      return {
        bom: bom.bom,
        encoding: bom.encoding,
        decision: 'invalid',
        asciiCompatible: false,
        safeRead: false,
        eol: emptyEol(),
        candidates: [{ encoding: bom.encoding, valid: false, confidence: 'confirmed' }],
        errors: [makeError('NOJIBAKE_INVALID_UTF16_TRUNCATED', 'UTF-16 payload has an odd byte length.', { encoding: bom.encoding })]
      };
    }
    try {
      const text = strictDecode(payload, bom.encoding);
      return {
        bom: bom.bom,
        encoding: bom.encoding,
        decision: 'confirmed',
        asciiCompatible: bom.encoding === 'utf-8',
        safeRead: true,
        eol: makeEolSummary(text),
        candidates: [{ encoding: bom.encoding, valid: true, confidence: 'confirmed' }],
        errors: []
      };
    } catch {
      return {
        bom: bom.bom,
        encoding: bom.encoding,
        decision: 'invalid',
        asciiCompatible: false,
        safeRead: false,
        eol: emptyEol(),
        candidates: [{ encoding: bom.encoding, valid: false, confidence: 'confirmed' }],
        errors: [makeError('NOJIBAKE_INVALID_CONFIRMED_ENCODING', 'BOM-confirmed text failed strict validation.', { encoding: bom.encoding })]
      };
    }
  }

  if (isAscii(bytes)) {
    const text = strictDecode(bytes, 'utf-8');
    return {
      bom: 'none',
      encoding: 'ascii',
      decision: 'ascii',
      asciiCompatible: true,
      safeRead: true,
      eol: makeEolSummary(text),
      candidates: [
        { encoding: 'utf-8', valid: true, confidence: 'candidate' },
        { encoding: 'windows-949', valid: true, confidence: 'candidate' }
      ],
      errors: []
    };
  }

  const candidates: EncodingCandidate[] = [];
  let utf8Text: string | null = null;
  try {
    utf8Text = strictDecode(bytes, 'utf-8');
    candidates.push({ encoding: 'utf-8', valid: true, confidence: 'candidate' });
  } catch {
    candidates.push({ encoding: 'utf-8', valid: false, confidence: 'candidate' });
  }
  const cp949Valid = isCp949RoundTrip(bytes);
  candidates.push({ encoding: 'windows-949', valid: cp949Valid, confidence: 'candidate' });

  const validCandidates = candidates.filter((candidate) => candidate.valid);
  if (validCandidates.length > 1) {
    return {
      bom: 'none',
      encoding: 'ambiguous',
      decision: 'ambiguous',
      asciiCompatible: true,
      safeRead: true,
      eol: makeEolSummary(utf8Text ?? iconv.decode(bytes, 'windows-949')),
      candidates,
      errors: []
    };
  }
  if (utf8Text !== null) {
    return {
      bom: 'none',
      encoding: 'utf-8',
      decision: 'candidate',
      asciiCompatible: true,
      safeRead: true,
      eol: makeEolSummary(utf8Text),
      candidates,
      errors: []
    };
  }
  if (cp949Valid) {
    return {
      bom: 'none',
      encoding: 'windows-949',
      decision: 'candidate',
      asciiCompatible: true,
      safeRead: true,
      eol: makeEolSummary(iconv.decode(bytes, 'windows-949')),
      candidates,
      errors: []
    };
  }

  return {
    bom: 'none',
    encoding: 'unknown',
    decision: 'invalid',
    asciiCompatible: false,
    safeRead: false,
    eol: emptyEol(),
    candidates,
    errors: [
      makeError('NOJIBAKE_INVALID_BYTES', 'Bytes are not valid UTF-8 or windows-949.', {
        utf8InvalidOffset: firstInvalidUtf8Offset(bytes)
      })
    ]
  };
}

export function buildInspectData(input: { path: string; root: string | null; bytes: Buffer }): InspectData {
  const analysis = analyzeBytes(input.bytes);
  return {
    path: input.path,
    root: input.root,
    length: input.bytes.length,
    sha256: sha256(input.bytes),
    bom: analysis.bom,
    encoding: analysis.encoding,
    decision: analysis.decision,
    asciiCompatible: analysis.asciiCompatible,
    eol: analysis.eol,
    safeRead: analysis.safeRead,
    safeRewrite: false,
    candidates: analysis.candidates
  };
}

export function encodingErrors(bytes: Buffer): ResultError[] {
  return analyzeBytes(bytes).errors;
}
