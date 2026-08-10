# Build and Release Guide

Version: 0.2.0

Status: Work Packages 1 through 9 complete; Step 5 review and opt-in live smoke are complete.

Last verified: 2026-08-05

## 1. Development Baseline

| Tool | Baseline | Notes |
| --- | --- | --- |
| Node.js | 24 LTS | Runtime target and CI baseline; support policy may include other active LTS releases after package smoke tests |
| pnpm | 11.20.0 | Package manager recorded in `packageManager` |
| TypeScript | 7.0.2 | Strict type checking |
| tsup | 8.5.1 | ESM/CJS/type declaration build |
| Vitest | 4.1.10 | Unit, contract, and integration tests |
| ESLint | 10.8.0 | Flat-config linting |
| Changesets | 2.31.1 | Versioning and release notes |

Exact resolved versions belong in `pnpm-lock.yaml`. Before implementation, confirm that tsup and the lint/test toolchain support the selected TypeScript major together. If they do not, select the newest mutually supported versions and update `INTEGRATIONS.md` and `DECISIONS.md` before coding.

## 2. Prerequisites

- Node.js 24 LTS
- Corepack enabled, or pnpm 11.20.0 installed explicitly
- Git
- Network access only for dependency installation and opt-in live provider tests

Expected setup after `package.json` exists:

```bash
corepack enable
corepack prepare pnpm@11.20.0 --activate
pnpm install --frozen-lockfile
```

The repository's `pnpm-workspace.yaml` allowlist permits only the `esbuild` lifecycle script required by tsup. No other dependency build scripts are enabled.

Use `pnpm install` without `--frozen-lockfile` only when intentionally updating dependencies. Commit the resulting lockfile in the same milestone.

## 3. Planned Package Scripts

The implementation must provide these scripts with these meanings:

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm lint` | Run ESLint over source, tests, and configuration |
| `pnpm test` | Run deterministic unit, contract, and execution integration tests once |
| `pnpm test:watch` | Run local Vitest watch mode |
| `pnpm test:live` | Run opt-in provider tests; passes when no live tests or credentials are available |
| `pnpm build` | Build ESM, CommonJS, declarations, and source maps into `dist/` |
| `pnpm test:package` | Pack and consume the tarball from ESM, CJS, and TypeScript smoke projects |
| `pnpm check` | Run typecheck, lint, test, build, and package tests in that order |
| `pnpm changeset` | Create a release changeset |
| `pnpm clean` | Remove only known generated build/test output paths |

No script should modify source files unless its name makes that behavior explicit, such as a future `format:write` script.

## 4. Planned Installation and Build

After the bootstrap implementation package is approved and complete:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Expected artifacts:

```text
dist/
├── index.js
├── index.cjs
├── index.d.ts
├── index.d.cts
└── source maps
```

The exact declaration filenames may differ based on tsup output. `package.json` exports, smoke tests, and this document must agree with the actual artifact names.

## 5. Compiler and Build Policy

The TypeScript configuration must enable strict checking, including:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `useUnknownInCatchVariables`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`

The target is modern Node.js (`ES2022` or newer as supported by the selected toolchain). Source files use explicit named exports. Public runtime and type exports are enumerated in `src/index.ts`; internal modules are not reachable through package export wildcards.

The package build must:

- produce ESM and CommonJS entry points;
- produce declarations and source maps; Work Package 1 uses TypeScript declaration emit because the selected tsup declaration plugin is not compatible with TypeScript 7;
- mark only genuine runtime dependencies as external;
- set `sideEffects: false` only after tests confirm there are no import-time side effects;
- exclude tests, fixtures, local environment files, and provider credentials from the tarball;
- avoid a default export.

## 6. Test Layout and Commands

### Default suite

`pnpm test` must require no network and no real API keys. It includes:

- pure domain and mapper unit tests;
- provider fixture contract tests through a fake transport;
- execution tests with fake clock and deterministic jitter;
- redaction and malicious-input tests.

### Live suite

`pnpm test:live` is opt-in. The test runner may read these variables; the SDK itself may not:

```text
ETHERSCAN_API_KEY
BLOCKSCOUT_API_KEY
ALCHEMY_API_KEY
MORALIS_API_KEY
```

Live tests must use stable public addresses and low request counts. High-page-size checks are allowed only as one bounded first-page request: verify Etherscan at 10,000, Alchemy single-direction at 1,000, and Alchemy both-direction at a small page size without logging request URLs, keys, cursors, or items. They must skip unavailable provider/chain capabilities rather than weakening deterministic tests. Output must never print keys or raw authenticated URLs.

The repository includes `scripts/live-config.mjs` and `scripts/live-smoke.mjs` for an owner-invoked smoke run. The config helper parses the grouped-key format in `.env.key` in memory and returns a normal `ClientConfiguration`; it never writes keys. The smoke runner uses the public Ethereum address in the script, caps list checks at two pages, and reports only provider/operation/status/count/error-code summaries. Set `EVM_SDK_LIVE_PROXY` to an HTTP(S) proxy URL to exercise proxy-only and mixed routing; the proxy value is never printed.

### Package suite

`pnpm test:package` must run `pnpm pack`, consume the produced tarball from temporary ESM/CJS/TypeScript consumers, and validate public imports. Temporary paths must be narrow and safely removed. The suite must inspect tarball contents for accidental fixtures, `.env` files, and source credentials.

### Planned v0.3 runtime checks

The v0.3 proposal adds a lazily managed sing-box executable but must not add a
binary to the npm tarball or an unconditional networked `postinstall`. Default
tests use fake download, filesystem, child-process, and readiness seams. They
must cover the fixed `linux|darwin|win32 × x64|arm64` asset mapping, SHA-256
verification, safe archive extraction, cache permissions, startup/abort/close,
and the invariant that a client without `advancedProxy` has no process or
network side effect. An opt-in live smoke may use an explicitly supplied binary
or download mirror; it must never print proxy URLs or runtime config.

The block-range operation is tested with fixture providers and has no public
`pageSize`; its test suite must prove closed-range coverage, overlap dedup,
dense-block progress, provider pinning, bounded fallback before first response,
incomplete/stalled errors, and explicit record-limit failure.

Callback-mode tests must additionally prove that only complete windows are
emitted, callback-consumed records are not retained in the aggregate result,
and configured provider pacing has no delay before a single first request but
does delay a real subsequent request.

## 7. Local Usage During Development

This repository is a library, not a server. There is no long-running development URL. Use tests or a small ignored example script after the package exists:

```bash
pnpm build
node examples/basic.mjs
```

Examples must read credentials from the application's environment and must never contain real keys.

## 8. CI Baseline

The initial CI matrix should run on Linux with Node.js 24 LTS and execute:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Add the previous active Node.js LTS line only after package tests pass there. Live tests are never run on untrusted pull requests and require an explicitly protected workflow with secrets.

CI should also verify:

- the working tree remains clean after `pnpm check`;
- documentation-required files exist;
- the package tarball contains only intended files;
- no known secret patterns occur in tracked files or snapshots.

## 9. Release Process

This SDK is deployed by publishing an npm package; it has no service deployment.

1. Ensure the architecture is approved and `docs/NEXT_SESSION.md` has no release blocker.
2. Run `pnpm check` from a clean worktree.
3. Add a changeset describing public behavior.
4. Merge the versioning changes produced by Changesets.
5. Confirm package name, version, license, repository, files, exports, and provenance settings.
6. Run `pnpm pack` and inspect the tarball.
7. Publish through the repository's approved CI release workflow.
8. Verify ESM, CommonJS, and declaration consumption from the published package.

Do not publish manually until package ownership, npm package name, access level, license, and CI provenance are decided by the owner.

## 10. Current Build State

Work Packages 1 through 9 provide the public `EvmDataClient`, address/token services, capability-aware Etherscan V2, Moralis, and scoped Alchemy adapters, bounded execution, proxy-only and mixed-route scheduling, package smoke checks, and fixture-backed tests. The v0.2 price upgrade adds fixture-backed Binance Spot, OKX Spot UTC daily candles, Coinbase Exchange, and GeckoTerminal adapters plus a separate no-key aggregation path. `pnpm check` remains the release gate. Live tests are opt-in and must read application-owned secrets outside the SDK; the deterministic price suite does not require price credentials or network access.
