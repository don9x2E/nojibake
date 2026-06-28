# Nojibake

English | [한국어](#한국어)

Nojibake is a read-only Node.js CLI for inspecting file bytes before text processing. It reports encoding signals, BOM state, line-ending summary, SHA-256, and safety decisions in a stable JSON envelope.

It is designed for agent/Codex/OpenCode preflight checks: inspect metadata before loading file contents into an LLM context or rewriting files that may be CP949, UTF-16, binary, or line-ending sensitive.

Nojibake does not modify files. It is a read-only preflight guard for agents and CI, not an automatic encoding converter.

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

## Agent integration

Installing Nojibake does not automatically intercept an agent's file reads or writes. It is a CLI guard that agents, hooks, CI jobs, or tool wrappers must call explicitly.

Recommended integration layers:

1. **Agent instructions**: put a short Nojibake rule in `AGENTS.md`, `CLAUDE.md`, or another agent rules file.
2. **Pre-commit hook**: block unsafe staged changes before they enter git history.
3. **CI guard**: reject pull requests that introduce unsafe or policy-disallowed files.
4. **Tool wrapper**: for deeper integration, wrap an agent's `read_file`, `write_file`, or `patch` tool so it calls `nojibake inspect` before reading and `nojibake guard` before or after edits.

Minimal agent instruction:

```md
Before reading or editing legacy, Windows, CJK, or unknown-encoding files, run:

nojibake scan --root . --path <path> --json --compact

Before committing staged changes, run:

git diff --cached --name-only | nojibake guard --root . --stdin-paths --fail-on unsafe,ambiguous,mixed-eol,disallowed-encoding --json --compact

If Nojibake reports `safeRead: false`, `safeRewrite: false`, `ambiguous`, `mixed-eol`, `windows-949`, or `utf-16le`, do not rewrite the file with normal UTF-8 text tools until the encoding and line-ending strategy is explicit.
```

Pre-commit hook example:

```sh
#!/bin/sh
set -eu

git diff --cached --name-only | nojibake guard \
  --root . \
  --stdin-paths \
  --fail-on unsafe,ambiguous,mixed-eol,disallowed-encoding \
  --json --compact
```

For project-specific policy, add `.nojibakerc.json` and tune `allowEncodings`, `failOn`, `ignore`, `maxFiles`, and `maxBytes`.

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

## 한국어

Nojibake는 텍스트 처리 전에 파일 바이트를 먼저 점검하는 **읽기 전용 Node.js CLI**입니다. 인코딩 신호, BOM 상태, 줄바꿈 요약, SHA-256, 안전 판정 결과를 안정적인 JSON envelope로 출력합니다.

Codex, OpenCode, Claude Code 같은 agent가 파일 내용을 LLM context에 넣거나 파일을 다시 쓰기 전에, CP949/windows-949, UTF-16, binary, mixed EOL 같은 위험 신호를 먼저 확인하는 용도로 만들었습니다.

Nojibake는 파일을 수정하지 않습니다. 자동 인코딩 변환기가 아니라, agent와 CI를 위한 read-only preflight guard입니다.

### 설치

```sh
npm install
npm run build
```

향후 npm 패키지로 공개된 뒤에는 다음처럼 사용할 수 있습니다.

```sh
npx nojibake version --json
```

### 명령어

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

`scan`은 지정한 root 아래를 재귀적으로 스캔합니다. `--path`를 하나 이상 넘기거나 `--stdin-paths`를 쓰면 해당 파일 목록만 검사합니다. 기본적으로 `.git`, `node_modules`, `dist`, `coverage`는 건너뜁니다.

`--stdin-paths`는 stdin에서 newline-separated path 목록을 읽습니다. Nojibake가 직접 `git`이나 child process를 실행하지 않아도 `git diff --name-only` 결과를 안전하게 연결할 수 있습니다.

### `.nojibakerc.json`

스캔 root에 `.nojibakerc.json`을 두면 프로젝트 기본 정책을 저장할 수 있습니다.

```json
{
  "maxFiles": 5000,
  "maxBytes": 200000,
  "ignore": ["dist/**", "node_modules/**", "*.png"],
  "failOn": ["unsafe", "ambiguous", "mixed-eol"],
  "allowEncodings": ["utf-8", "ascii", "utf-16le", "windows-949"]
}
```

`guard`는 같은 입력을 스캔한 뒤, 요청한 정책에 걸리면 non-zero로 종료합니다.

정책은 다음과 같습니다.

- `unsafe`: path safety 실패, 읽기 실패, invalid bytes, binary NUL, 또는 `safeRead: false`
- `ambiguous`: 여러 non-ASCII 인코딩 후보가 동시에 유효함
- `mixed-eol`: CRLF/LF/CR 줄바꿈이 섞여 있음
- `non-utf8`: 감지 인코딩이 `utf-8` 또는 `ascii`가 아님
- `disallowed-encoding`: 감지 인코딩이 `allowEncodings`에 없음

### Agent token 절약 workflow

파일 내용을 읽기 전에 compact scan으로 먼저 metadata만 확인합니다.

```sh
nojibake scan --root . --path README.md --path src/cli.ts --json --compact
```

Compact output은 agent가 token을 쓰기 전에 파일을 필터링하기 쉽게 짧은 key를 사용합니다.

- `p`: path
- `l`: byte length
- `e`: encoding
- `d`: decision
- `sr`: safeRead
- `sw`: safeRewrite
- `mix`: mixed line endings
- `why`: reason codes
- `err`: error codes

### Agent 통합

Nojibake를 설치하는 것만으로 agent의 파일 읽기/쓰기를 자동으로 가로채지는 않습니다. Nojibake는 agent, hook, CI, tool wrapper가 명시적으로 호출해야 하는 CLI guard입니다.

권장 통합 단계는 다음과 같습니다.

1. **Agent instructions**: `AGENTS.md`, `CLAUDE.md` 같은 agent rules 파일에 Nojibake 규칙을 넣습니다.
2. **Pre-commit hook**: staged change가 git history에 들어가기 전에 unsafe 파일을 차단합니다.
3. **CI guard**: PR/push에서 unsafe 또는 프로젝트 정책에 맞지 않는 파일을 차단합니다.
4. **Tool wrapper**: 더 깊게 통합하려면 agent의 `read_file`, `write_file`, `patch` 도구 앞뒤에서 `nojibake inspect` 또는 `nojibake guard`를 호출하도록 감쌉니다.

최소 agent instruction 예시는 다음과 같습니다.

```md
legacy, Windows, CJK, unknown-encoding 파일을 읽거나 수정하기 전에 실행:

nojibake scan --root . --path <path> --json --compact

staged change를 commit하기 전에 실행:

git diff --cached --name-only | nojibake guard --root . --stdin-paths --fail-on unsafe,ambiguous,mixed-eol,disallowed-encoding --json --compact

Nojibake가 `safeRead: false`, `safeRewrite: false`, `ambiguous`, `mixed-eol`, `windows-949`, `utf-16le`를 보고하면 인코딩/줄바꿈 전략이 명확해질 때까지 일반 UTF-8 텍스트 도구로 덮어쓰지 마세요.
```

Pre-commit hook 예시는 다음과 같습니다.

```sh
#!/bin/sh
set -eu

git diff --cached --name-only | nojibake guard \
  --root . \
  --stdin-paths \
  --fail-on unsafe,ambiguous,mixed-eol,disallowed-encoding \
  --json --compact
```

프로젝트별 정책은 `.nojibakerc.json`에서 `allowEncodings`, `failOn`, `ignore`, `maxFiles`, `maxBytes`를 조정해 관리합니다.

### `inspect path`가 확인하는 것

`inspect path`는 읽기 전용입니다. 다음 정보를 보고합니다.

- byte length와 SHA-256
- UTF-8, UTF-16LE, UTF-16BE BOM 감지
- BOM 기반 텍스트의 strict validation
- binary NUL 감지
- BOM 없는 UTF-8 strict validation
- windows-949 round-trip validation
- 여러 non-ASCII 후보가 동시에 유효한 ambiguous result
- CRLF, LF, CR 줄바꿈 카운트
- `safeRead`, `safeRewrite: false`

### Path safety

Nojibake는 missing file, directory, Windows alternate data stream 표기, symlink traversal, optional root 밖으로 벗어나는 파일을 거부합니다.

### 개발

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

CI는 Ubuntu, Windows, macOS에서 Node 20/22 matrix로 실행됩니다. 별도 Windows shell job은 PowerShell/CMD에서 CJK 파일명과 stdin path list 동작을 확인합니다.
