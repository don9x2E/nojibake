# Changelog

## 0.1.0

- Initial read-only encoding inspection CLI.
- Added strict UTF-8, UTF-16 BOM, windows-949, binary NUL, EOL, SHA-256, and path-safety reporting.
- Added JSON-first result envelope and schema command.
- Added recursive/file-list `scan` command for agent preflight workflows.
- Added `guard` command with `unsafe`, `ambiguous`, `mixed-eol`, and `non-utf8` policies.
- Added compact JSON output for token-efficient agent contexts.
- Added `--stdin-paths` so callers can pipe changed-file lists without Nojibake executing `git`.
- Added `.nojibakerc.json` support for `maxFiles`, `maxBytes`, `ignore`, `failOn`, and `allowEncodings` defaults.
- Added compact scan summary counts and standardized reason codes for agent decisions.
- Added human-readable `--pretty` output for inspect, scan, and guard.
- Fixed npm bin symlink entrypoint detection for installed CLI execution.
- Hardened GitHub Actions permissions for public repository use.
- Expanded CI to Ubuntu, Windows, and macOS on Node 20/22.
- Added Windows/CJK smoke coverage for PowerShell, CMD, npm-installed bin shims, Hangul file names, CP949, UTF-16LE `.rc`, CRLF stdin path lists, ADS-shaped paths, and mixed EOL.
