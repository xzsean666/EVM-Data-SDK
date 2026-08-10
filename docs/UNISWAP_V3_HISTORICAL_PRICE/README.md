# Uniswap V3 Historical Price

This directory contains the design, execution queue, implementation prompt,
and durable AI handoff for the Uniswap V3 historical price module.

| Document | Purpose |
| --- | --- |
| [`UPGRADE.md`](./UPGRADE.md) | Product contract, architecture, formulas, errors, and acceptance criteria. |
| [`TASK_BREAKDOWN.md`](./TASK_BREAKDOWN.md) | Ordered implementation work packages and verification gates. |
| [`AI_IMPLEMENTATION_PROMPT.md`](./AI_IMPLEMENTATION_PROMPT.md) | Ready-to-paste prompt for Claude Sonnet 5 or ChatGPT Terra. |
| [`AI_CONTEXT.md`](./AI_CONTEXT.md) | Self-contained context for a later AI session, including the procedure for adding chains. |

Address policy: the SDK reads a committed, pre-generated manifest. Rankings
may discover candidates for the maintainer update command, but they are never
used as runtime truth or as a substitute for on-chain Factory verification.

Status: documentation and architecture proposal only. The source module has
not been implemented by this document change.
