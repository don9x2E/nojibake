import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const cli = join(projectRoot, 'dist', 'cli.js');
let readOnlyRoot = '';

function collectFiles(root: string): string[] {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        pending.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function treeHash(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const file of collectFiles(root)) {
    const bytes = readFileSync(file);
    hashes.set(relative(root, file).replace(/\\/g, '/'), createHash('sha256').update(bytes).digest('hex'));
  }
  return hashes;
}

function authoredFiles(): string[] {
  const roots = ['src', 'tests', 'scripts'];
  const files = roots.flatMap((root) => collectFiles(join(projectRoot, root)));
  files.push(
    join(projectRoot, 'README.md'),
    join(projectRoot, 'CHANGELOG.md'),
    join(projectRoot, 'LICENSE'),
    join(projectRoot, 'package.json'),
    join(projectRoot, 'tsconfig.json'),
    join(projectRoot, 'tsup.config.ts'),
    join(projectRoot, 'vitest.config.ts'),
    join(projectRoot, '.github', 'workflows', 'ci.yml')
  );
  const generatedFixtures = [
    join('tests', 'fixtures'),
    join('tests', 'path-fixtures'),
    join('tests', 'cli-fixtures'),
    join('tests', 'config-fixtures'),
    join('tests', 'windows-fixtures'),
    join('tests', 'read-only-fixtures')
  ];
  return files.filter((file) => existsSync(file) && !generatedFixtures.some((fixture) => file.includes(fixture)));
}

function parseableJson(args: string[]): unknown {
  const output = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return JSON.parse(output);
}

beforeAll(() => {
  readOnlyRoot = mkdtempSync(join(tmpdir(), 'nojibake-read-only-'));
  mkdirSync(readOnlyRoot, { recursive: true });
  writeFileSync(join(readOnlyRoot, 'sample.txt'), 'hello\r\n');
});

afterAll(() => {
  if (readOnlyRoot !== '') rmSync(readOnlyRoot, { recursive: true, force: true });
});

describe('release hygiene', () => {
  it('keeps authored project files free of old workplace fingerprints', () => {
    const forbidden = [
      ['h', 'mw'].join(''),
      ['H', 'MW'].join(''),
      ['Smart', 'Platform'].join(''),
      ['Smart', 'Platform', 'V5'].join(''),
      ['M', 'MI'].join(''),
      ['R', 'TOS'].join(''),
      ['S', 'VN'].join(''),
      ['s', 'vn'].join(''),
      ['policy', 'Id'].join(''),
      ['protected', 'Roots'].join(''),
      ['ses', 'sion'].join('')
    ];
    for (const file of authoredFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const token of forbidden) {
        expect(text, `${file} contains ${token}`).not.toContain(token);
      }
    }
  });

  it('does not use banned write or execution APIs in CLI source', () => {
    const banned = [
      'writeFile',
      'appendFile',
      'rmSync',
      'unlink',
      'exec(',
      ['ev', 'al('].join(''),
      ['as', 'any'].join(' '),
      ['@ts', '-ignore'].join(''),
      ['@ts', '-expect-error'].join(''),
      ['catch', '{}'].join(' ')
    ];
    for (const file of collectFiles(join(projectRoot, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const token of banned) {
        expect(text, `${file} contains ${token}`).not.toContain(token);
      }
    }
  });

  it('leaves inspected fixture bytes unchanged across read-only commands', () => {
    const before = treeHash(readOnlyRoot);
    parseableJson(['version', '--json']);
    parseableJson(['schema', 'result', '--json']);
    parseableJson(['inspect', 'path', '--root', readOnlyRoot, '--path', 'sample.txt', '--json']);
    const after = treeHash(readOnlyRoot);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [file, hash] of before) {
      expect(after.get(file)).toBe(hash);
    }
  });
});
