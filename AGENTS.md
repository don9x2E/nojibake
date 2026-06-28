# AGENTS.md

Guidance for AI coding agents working in this repository.

## Nojibake is a preflight guard, not an automatic interceptor

Installing `nojibake` does not automatically monitor file reads or writes. Agents must call it before reading, rewriting, or committing files where encoding or line endings may matter.

Use Nojibake especially for:

- Windows or legacy files
- CJK/Hangul file names or content
- `.rc`, `.sln`, `.vcxproj`, `.bat`, `.cmd`, `.ps1`, `.reg`, `.ini`, `.csv`, and other Windows-adjacent text files
- files suspected to be CP949/windows-949, UTF-16LE, binary, or mixed-EOL
- generated path lists from `git diff`, `git diff --cached`, or review tooling

## Before reading or editing a suspicious file

Run a targeted compact scan first:

```sh
nojibake scan --root . --path <path> --json --compact
```

For several known files:

```sh
nojibake scan --root . --path <file1> --path <file2> --json --compact
```

If Nojibake reports any of the following, do not rewrite the file with normal UTF-8 text tools until the encoding and line-ending strategy is explicit:

- `safeRead: false`
- `safeRewrite: false`
- `ambiguous`
- `mixed-eol`
- `windows-949`
- `utf-16le`
- `encoding:binary`
- `encoding:invalid`
- `encoding:disallowed`

## Before committing

Check staged files with the guard command:

```sh
git diff --cached --name-only | nojibake guard \
  --root . \
  --stdin-paths \
  --fail-on unsafe,ambiguous,mixed-eol,disallowed-encoding \
  --json --compact
```

If the command exits non-zero, inspect the JSON result and either:

1. fix the file safely while preserving its intended encoding and line endings,
2. update `.nojibakerc.json` if the file is intentionally allowed, or
3. leave the file untouched and explain the blocker.

## For repository-wide checks

Use recursive scan when you need a broad inventory:

```sh
nojibake scan --root . --json --compact
```

The recursive scan skips `.git`, `node_modules`, `dist`, and `coverage` by default. Do not pass `--include-ignored` unless you intentionally want generated or vendored files.

## Editing rules

- Keep Nojibake read-only. Do not add code paths that modify inspected files as part of `inspect`, `scan`, or `guard`.
- Prefer explicit file lists (`--path` or `--stdin-paths`) over hidden child-process behavior.
- Preserve machine-readable JSON output and stable reason codes; agent integrations depend on them.
- When changing CLI behavior, update both the English and Korean README sections if user-facing behavior changes.
- For Windows/CJK behavior, keep tests covering PowerShell, CMD, CRLF stdin lists, Hangul/CJK file names, CP949/windows-949, UTF-16LE `.rc`, mixed EOL, and ADS-shaped paths.

## Verification

For code changes, run at least:

```sh
npm run typecheck
npm test
npm run smoke
npm run smoke:windows
npm run smoke:installed
npm run pack:check
```

For documentation-only changes, `npm run pack:check` is usually enough, but still run the staged Nojibake guard before committing.
