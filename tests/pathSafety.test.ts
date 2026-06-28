import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveSafePath } from '../src/pathSafety.js';

const root = join(process.cwd(), 'tests', 'path-fixtures');

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'inside'), { recursive: true });
  writeFileSync(join(root, 'inside', 'file.txt'), 'hello');
  writeFileSync(join(root, 'outside.txt'), 'outside');
});

describe('path safety', () => {
  it('allows a normal file inside the optional root', () => {
    const result = resolveSafePath('file.txt', join(root, 'inside'));
    expect(result.ok).toBe(true);
    expect(result.path).toBe(resolve(root, 'inside', 'file.txt').replace(/\\/g, '/'));
  });

  it('rejects paths outside the optional root', () => {
    const result = resolveSafePath('../outside.txt', join(root, 'inside'));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('NOJIBAKE_PATH_OUTSIDE_ROOT');
  });

  it('rejects missing paths and directories', () => {
    expect(resolveSafePath('missing.txt', root).errors[0]?.code).toBe('NOJIBAKE_PATH_NOT_FOUND');
    expect(resolveSafePath('inside', root).errors[0]?.code).toBe('NOJIBAKE_PATH_DIRECTORY_REJECTED');
  });

  it('rejects Windows ADS notation', () => {
    const result = resolveSafePath('inside/file.txt:stream', root);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === 'NOJIBAKE_PATH_ADS_REJECTED')).toBe(true);
  });

  it('rejects symlinks when the platform supports them', () => {
    try {
      symlinkSync(join(root, 'inside', 'file.txt'), join(root, 'inside', 'link.txt'));
    } catch {
      return;
    }
    const result = resolveSafePath('link.txt', join(root, 'inside'));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('NOJIBAKE_PATH_LINK_REJECTED');
  });

  it('rejects intermediate directory symlink traversal when the platform supports it', () => {
    try {
      symlinkSync(join(root, 'inside'), join(root, 'linked-inside'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    const result = resolveSafePath('linked-inside/file.txt', root);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('NOJIBAKE_PATH_LINK_REJECTED');
  });
});
