# Nojibake

Nojibake is a read-only Node.js CLI for inspecting file bytes before text processing. It reports encoding signals, BOM state, line-ending summary, SHA-256, and safety decisions in a stable JSON envelope.

It is designed for agent/Codex/OpenCode preflight checks: inspect metadata before loading file contents into an LLM context or rewriting files that may be CP949, UTF-16, binary, or line-ending sensitive.

## Install

```sh
npm install
npm run build
```

For a published package later:

```sh
npx nojibake version --json
```

## Commands

```sh
nojibake version --json
nojibake schema result --json

nojibake inspect path --path ./file.txt --json
nojibake inspect path --root ./safe-root --path ./file.txt --json --compact
nojibake inspect path --root ./safe-root --path ./file.txt --pretty

nojibake scan --root . --json --compact
nojibake scan --root . --path README.md --path src/cli.ts --json --compact
git diff --name-only | nojibake scan --root . --stdin-paths --json --compact
nojibake scan --root . --pretty

nojibake guard --root . --fail-on unsafe --json
git diff --cached --name-only | nojibake guard --root . --stdin-paths --fail-on unsafe,ambiguous,mixed-eol --json --compact
nojibake guard --root . --fail-on unsafe,ambiguous,mixed-eol,disallowed-encoding --json --compact
```

`scan` recursively scans a root directory unless one or more `--path` options are supplied or `--stdin-paths` is used. Recursive scans skip `.git`, `node_modules`, `dist`, and `coverage` by default; pass `--include-ignored` to include them. Use `--max-files <n>` to bound large repositories and `--max-bytes <n>` to avoid reading oversized files.

`--stdin-paths` reads newline-separated paths from stdin. This gives you `scan --changed` behavior without letting Nojibake execute `git` or any child process.

Project defaults can be stored in `.nojibakerc.json` at the scan root:

```json
{
  "maxFiles": 5000,
  "maxBytes": 200000,
  "ignore": ["dist/**", "node_modules/**", "*.png"],
  "failOn": ["unsafe", "ambiguous", "mixed-eol"],
  "allowEncodings": ["utf-8", "ascii", "utf-16le", "windows-949"]
}
```

`guard` scans the same inputs and exits non-zero when a requested policy fails.

Guard policies:

- `unsafe`: failed path safety, unreadable file, invalid bytes, binary NUL, or `safeRead: false`
- `ambiguous`: bytes are valid under more than one non-ASCII candidate
- `mixed-eol`: CRLF/LF/CR are mixed
- `non-utf8`: detected encoding is not `utf-8` or `ascii`
- `disallowed-encoding`: detected encoding is not listed in `allowEncodings`

Scan and guard results include standardized machine-readable reason codes such as `read:unsafe`, `encoding:binary`, `encoding:ambiguous`, `encoding:non-utf8`, `encoding:disallowed`, `eol:mixed`, and `large:file`.

## Agent-token workflow

Use compact scan output before reading file contents:

```sh
nojibake scan --root . --path README.md --path src/cli.ts --json --compact
```

Compact keys are intentionally short:

- `p`: path
- `l`: byte length
- `e`: encoding
- `d`: decision
- `sr`: safeRead
- `sw`: safeRewrite
- `mix`: mixed line endings
- `why`: standardized reason codes
- `err`: error codes

Compact scan summaries include `ok`, `n`, `bytes`, `safe`, `unsafe`, `amb`, `mix`, `err`, `skip`, and short histograms for decisions, encodings, and reason codes.

This lets an agent filter files by metadata before spending tokens on full file contents.

## JSON envelope

JSON commands emit a JSON-first result envelope:

```json
{
  "schemaVersion": "1.0.0",
  "toolVersion": "0.1.0",
  "invocationId": "00000000-0000-0000-0000-000000000000",
  "ok": true,
  "command": "version",
  "summary": "Nojibake 0.1.0",
  "data": {},
  "errors": [],
  "warnings": []
}
```

## Inspection output

`inspect path` is read-only. It reports:

- byte length and SHA-256
- BOM detection for UTF-8, UTF-16LE, and UTF-16BE
- strict validation for BOM-confirmed text
- binary NUL detection
- strict UTF-8 validation without BOM
- windows-949 validation by round-trip conversion
- ambiguous results when more than one non-ASCII candidate is valid
- EOL counts for CRLF, LF, and CR
- `safeRead` and `safeRewrite: false`

## Path safety

Nojibake rejects missing files, directories, Windows alternate data stream notation, symlink traversal, and files outside an optional root boundary.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:windows
npm run smoke:installed
npm run pack:check
```

CI runs the full suite on Ubuntu, Windows, and macOS with Node 20 and 22. A separate Windows shell job checks PowerShell and CMD behavior with CJK file names and stdin path lists.

Repository metadata currently targets `https://github.com/don9x2E/nojibake`. Change it before upload only if you plan to publish under a different account or organization.

## License

MIT
