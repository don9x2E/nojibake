import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GuardPolicy } from './types.js';

export interface NojibakeConfig {
  maxFiles?: number;
  maxBytes?: number;
  includeIgnored?: boolean;
  ignore?: string[];
  failOn?: GuardPolicy[];
  allowEncodings?: string[];
}

const allowedPolicies: readonly GuardPolicy[] = ['unsafe', 'ambiguous', 'mixed-eol', 'non-utf8', 'disallowed-encoding'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

function parseBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean.`);
  return value;
}

function parseStringArray(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function parsePolicies(value: unknown): GuardPolicy[] | undefined {
  const items = parseStringArray(value, 'failOn');
  if (items === undefined) return undefined;
  const policies: GuardPolicy[] = [];
  for (const item of items) {
    if (!allowedPolicies.includes(item as GuardPolicy)) {
      throw new Error(`Unknown guard policy in config: ${item}`);
    }
    policies.push(item as GuardPolicy);
  }
  return [...new Set(policies)];
}

export function parseConfigText(text: string, source: string): NojibakeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    throw new Error(`Could not parse ${source}: ${message}`);
  }
  if (!isRecord(parsed)) throw new Error(`${source} must contain a JSON object.`);

  const config: NojibakeConfig = {};
  const maxFiles = parsePositiveInteger(parsed.maxFiles, 'maxFiles');
  if (maxFiles !== undefined) config.maxFiles = maxFiles;
  const maxBytes = parsePositiveInteger(parsed.maxBytes, 'maxBytes');
  if (maxBytes !== undefined) config.maxBytes = maxBytes;
  const includeIgnored = parseBoolean(parsed.includeIgnored, 'includeIgnored');
  if (includeIgnored !== undefined) config.includeIgnored = includeIgnored;
  const ignore = parseStringArray(parsed.ignore, 'ignore');
  if (ignore !== undefined) config.ignore = ignore;
  const failOn = parsePolicies(parsed.failOn);
  if (failOn !== undefined) config.failOn = failOn;
  const allowEncodings = parseStringArray(parsed.allowEncodings, 'allowEncodings');
  if (allowEncodings !== undefined) config.allowEncodings = allowEncodings.map((encoding) => encoding.toLowerCase());
  return config;
}

export function loadConfig(root: string): NojibakeConfig {
  const configPath = join(resolve(root), '.nojibakerc.json');
  if (!existsSync(configPath)) return {};
  return parseConfigText(readFileSync(configPath, 'utf8'), configPath);
}
