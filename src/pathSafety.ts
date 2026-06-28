import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, parse, resolve, relative, sep } from 'node:path';
import { makeError } from './result.js';
import type { ResultError } from './types.js';

export interface SafePathResult {
  ok: boolean;
  path: string;
  root: string | null;
  errors: ResultError[];
}

function hasAdsNotation(inputPath: string): boolean {
  const parsed = parse(inputPath);
  const withoutDrive = parsed.root.startsWith(parsed.root[0] ?? '') && /^[A-Za-z]:[\\/]?$/.test(parsed.root)
    ? inputPath.slice(2)
    : inputPath;
  return withoutDrive.includes(':');
}

function isInsideRoot(realPath: string, realRoot: string): boolean {
  const rel = relative(realRoot, realPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function linkedComponent(path: string): string | null {
  const parsed = parse(path);
  const parts = relative(parsed.root, path).split(/[\\/]+/).filter((part) => part.length > 0);
  let current = parsed.root;
  for (const part of parts) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) return current;
  }
  return null;
}

export function resolveSafePath(inputPath: string, root?: string): SafePathResult {
  const resolvedRoot = root === undefined ? null : resolve(root);
  const base = resolvedRoot ?? process.cwd();
  const resolvedPath = resolve(base, inputPath);
  const errors: ResultError[] = [];

  if (hasAdsNotation(inputPath)) {
    errors.push(makeError('NOJIBAKE_PATH_ADS_REJECTED', 'Windows alternate data stream notation is rejected.'));
  }

  if (resolvedRoot !== null) {
    try {
      const rootLink = linkedComponent(resolvedRoot);
      if (rootLink !== null) {
        errors.push(makeError('NOJIBAKE_ROOT_LINK_REJECTED', 'Symlink or reparse root is rejected for MVP safety.', { root: rootLink }));
        return { ok: false, path: resolvedPath, root: resolvedRoot, errors };
      }
    } catch {
      errors.push(makeError('NOJIBAKE_ROOT_NOT_FOUND', 'Root does not exist.', { root: resolvedRoot }));
      return { ok: false, path: resolvedPath, root: resolvedRoot, errors };
    }
  }

  let pathLstat;
  try {
    pathLstat = lstatSync(resolvedPath);
  } catch {
    errors.push(makeError('NOJIBAKE_PATH_NOT_FOUND', 'Path does not exist.', { path: resolvedPath }));
    return { ok: false, path: resolvedPath, root: resolvedRoot, errors };
  }

  if (pathLstat.isSymbolicLink()) {
    errors.push(makeError('NOJIBAKE_PATH_LINK_REJECTED', 'Symlink or reparse traversal is rejected for MVP safety.', { path: resolvedPath }));
    return { ok: false, path: resolvedPath, root: resolvedRoot, errors };
  }

  const pathLink = linkedComponent(resolvedPath);
  if (pathLink !== null) {
    errors.push(makeError('NOJIBAKE_PATH_LINK_REJECTED', 'Symlink or reparse traversal is rejected for MVP safety.', { path: pathLink }));
    return { ok: false, path: resolvedPath, root: resolvedRoot, errors };
  }

  const pathStat = statSync(resolvedPath);
  if (pathStat.isDirectory()) {
    errors.push(makeError('NOJIBAKE_PATH_DIRECTORY_REJECTED', 'Directories cannot be inspected as files.', { path: resolvedPath }));
  } else if (!pathStat.isFile()) {
    errors.push(makeError('NOJIBAKE_PATH_NOT_FILE', 'Only regular files can be inspected.', { path: resolvedPath }));
  }

  if (resolvedRoot !== null) {
    const realRoot = realpathSync(resolvedRoot);
    const realTarget = realpathSync(resolvedPath);
    if (!isInsideRoot(realTarget, realRoot)) {
      errors.push(makeError('NOJIBAKE_PATH_OUTSIDE_ROOT', 'Path resolves outside the configured root boundary.', { path: realTarget, root: realRoot }));
    }
  }

  return { ok: errors.length === 0, path: resolvedPath.split(sep).join('/'), root: resolvedRoot, errors };
}
