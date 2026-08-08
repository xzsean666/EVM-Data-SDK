# Ready-to-paste gpt-terra implementation prompt

You are implementing the DeFi Exchange Rate Snapshot Module in
`/home/sean/git/EVM-Data-SDK`.

Before changing source, read completely: `Agent.md`,
`docs/DEFI_EXCHANGE_RATE_SNAPSHOT/UPGRADE.md`,
`docs/DEFI_EXCHANGE_RATE_SNAPSHOT/TASK_BREAKDOWN.md`,
`docs/DEFI_EXCHANGE_RATE_SNAPSHOT/AI_CONTEXT.md`, `docs/SPEC.md`,
`docs/ARCHITECTURE.md`, `docs/BUILD.md`, `docs/INTEGRATIONS.md`,
`docs/DECISIONS.md`, and `docs/NEXT_SESSION.md`. Then inspect every source and
test file named by `AI_CONTEXT.md`.

Implement the bounded packages in `TASK_BREAKDOWN.md` in order. The owner has
requested Ethereum Mainnet (1) and Base Mainnet (8453), built-in public Archive
RPC pools, random healthy endpoint selection, endpoint health marking, and
full-operation fallback. Use the existing direct-only `ArchiveRpcTransport`
and Multicall3 codec; do not add ethers/viem or another HTTP/RPC dependency.

Non-negotiable behavior:

- exact decimal block input converted to `blockTag`; never use `latest`;
- one operation pinned to one endpoint, with pre/post block hash checks;
- retryable endpoint/archive/reorg failure discards partial results and tries
  each other healthy endpoint at most once;
- protocol call reverts are per-token failures, not endpoint failures;
- no proxy, no environment proxy variables, no background timers;
- all public quantities are decimal strings and LP tokens return multiple legs;
- manifests are committed and never fetched or mutated at runtime;
- no secrets, endpoint URLs, calldata, returndata, or prices in logs/errors.

Use `apply_patch` for edits. Add deterministic fixture tests before live checks.
Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
`pnpm test:package`, and `pnpm check`. Update canonical docs and
`NEXT_SESSION.md` as each package completes. Do not push, rewrite history, or
invent Git identity. Report changed files, verification results, and any
unverified live endpoint/token facts clearly.
