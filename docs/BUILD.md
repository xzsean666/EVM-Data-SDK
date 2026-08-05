# Build and Release Guide

Version: 0.1.0 planning baseline

Status: Commands are specified but are not runnable until implementation starts after architecture approval.

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

Use `pnpm install` without `--frozen-lockfile` only when intentionally updating dependencies. Commit the resulting lockfile in the same milestone.

## 3. Planned Package Scripts

The implementation must provide these scripts with these meanings:

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm lint` | Run ESLint over source, tests, and configuration |
| `pnpm test` | Run deterministic unit, contract, and execution integration tests once |
| `pnpm test:watch` | Run local Vitest watch mode |
| `pnpm test:live` | Run opt-in provider tests; skipped without explicit credentials |
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
- produce declarations and source maps;
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
ALCHEMY_API_KEY
MORALIS_API_KEY
```

Live tests must use stable public addresses, small page sizes, and low request counts. They must skip unavailable provider/chain capabilities rather than weakening deterministic tests. Output must never print keys or raw authenticated URLs.

### Package suite

`pnpm test:package` must run `pnpm pack`, install the produced tarball into temporary ESM/CJS/TypeScript consumers, and validate public imports. Temporary paths must be narrow and safely removed. The suite must inspect tarball contents for accidental fixtures, `.env` files, and source credentials.

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

There is intentionally no `package.json`, source tree, lockfile, or runnable command yet. Creating them is Step 4 implementation and is blocked pending explicit architecture approval. The first implementation work package in `NEXT_SESSION.md` creates only the toolchain and empty package surface needed to make the checks executable.
