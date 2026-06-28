import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaVersion, type ResultEnvelope, type ResultError } from './types.js';

interface PackageJson {
  name: string;
  version: string;
}

function loadPackage(): PackageJson {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'package.json'), join(here, '..', '..', 'package.json')];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<PackageJson>;
      if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
        return { name: parsed.name, version: parsed.version };
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      continue;
    }
  }
  return { name: 'nojibake', version: '0.0.0' };
}

export const packageInfo = loadPackage();

export function makeError(code: string, message: string, details?: Record<string, unknown>): ResultError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function envelope<TData>(input: {
  ok: boolean;
  command: string;
  summary: string;
  data: TData | null;
  errors?: ResultError[];
  warnings?: ResultError[];
}): ResultEnvelope<TData> {
  return {
    schemaVersion,
    toolVersion: packageInfo.version,
    invocationId: randomUUID(),
    ok: input.ok,
    command: input.command,
    summary: input.summary,
    data: input.data,
    errors: input.errors ?? [],
    warnings: input.warnings ?? []
  };
}
