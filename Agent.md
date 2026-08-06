# AI Engineering Guide

Version: 1.0

This file is the entry point for every AI or human engineering session in this repository.

## Required Reading Order

Before changing the repository, read these files in order:

1. `Agent.md`
2. `docs/SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/BUILD.md`
5. `docs/INTEGRATIONS.md`
6. `docs/DECISIONS.md`
7. `docs/NEXT_SESSION.md`

Do not rely on previous conversations or hidden context. The repository documents are the source of truth. If the documents disagree, stop and resolve the disagreement in documentation before implementation.

## Current Gate

- Current workflow step: Step 4, v0.3 implementation.
- Architecture status: v0.1/v0.2 baseline and v0.3 ADR-023/ADR-024 are accepted by the owner in the current work request.
- Implementation status: Work Packages 1 through 11 and v0.3 P0 documentation/integration discovery are complete; v0.3 source implementation is authorized.
- Production code may be added only within the accepted v0.3 advanced-proxy and block-range design.

## Mandatory Workflow

Every task must follow this order and report the current step, purpose, and expected output before work starts.

### Step 0: Context Discovery

Read the required documents and inspect the repository. Report the existing system, modules, dependencies, missing information, and risks. Do not implement.

### Step 1: Architecture Design

Define the architecture, module responsibilities, inputs, outputs, dependencies, data flow, decisions, alternatives, and trade-offs. Do not implement.

### Step 2: Documentation

Update the required documents so another session can work without conversation history. External dependency or provider behavior must be documented in `docs/INTEGRATIONS.md` before it is used.

### Step 3: Context Handoff

Update `docs/NEXT_SESSION.md` with completed work, current state, pending tasks, next actions, risks, and unknown questions.

### Step 4: Implementation

Implementation requires explicit architecture approval. Before editing, list the files, reason, and expected impact. Implement one bounded work package from `docs/NEXT_SESSION.md`, test it, update the documentation, and make a meaningful commit. Never push automatically or rewrite history.

### Step 5: Review and Refactoring

Review module boundaries, dependency direction, naming, readability, side effects, duplication, extension cost, and testability. Fix detected design or quality problems before adding more scope.

## Project Rules

- Optimize for local understandability, predictable behavior, and incremental extension.
- Keep provider-specific request, response, error, and mapping logic inside that provider's directory.
- Use EIP-155 chain IDs as the canonical network identity. Human-readable aliases are input conveniences only.
- Route only to providers that declare support for the exact chain, operation, and request features.
- Never make semantically different provider endpoints appear interchangeable.
- Treat provider payloads and cursors as untrusted input and validate them at the boundary.
- Represent on-chain integer quantities as decimal strings in public models. Do not use JavaScript `number` for token amounts, gas values, or block numbers.
- Keep retries, credential selection, proxy selection, and provider fallback in the central execution layer. Adapters perform one upstream attempt.
- Apply a bounded total attempt and time budget. Never nest unbounded retries.
- A continuation cursor is pinned to its original provider. Do not switch providers between pages.
- API keys and proxy credentials must never appear in errors, logs, cursors, snapshots, or fixtures.
- Proxy routing is an optional transport concern, not a rate-limit bypass mechanism.
- No background health-check timers in v0.1. Use passive request outcomes and bounded cooldowns.
- Do not add generic `utils`, `manager`, or `base` modules. Name modules after their responsibility.
- Avoid abbreviations such as `cfg`, `tmp`, `svc`, and `mgr` in public or domain-facing names.
- Use composition and explicit dependencies; avoid global mutable state and hidden environment reads.
- Add a dependency only after recording its official documentation, selected version, purpose, and constraints in `docs/INTEGRATIONS.md`.

## Documentation Ownership

- `docs/SPEC.md`: product behavior and acceptance criteria.
- `docs/ARCHITECTURE.md`: component boundaries and data flow.
- `docs/BUILD.md`: local development, verification, packaging, and release.
- `docs/INTEGRATIONS.md`: external APIs, tools, versions, and current caveats.
- `docs/DECISIONS.md`: accepted or proposed architecture decisions and alternatives.
- `docs/NEXT_SESSION.md`: live handoff and ordered work queue.

Any behavior change must update the relevant documents in the same milestone.

## Definition of Done for an Implementation Package

- The package's acceptance criteria are satisfied.
- Unit and relevant integration tests pass.
- Type checking, linting, and build pass.
- Secrets are redacted in all failure paths.
- Public exports and error behavior are documented.
- `docs/NEXT_SESSION.md` reflects the new state.
- The change is committed with a focused conventional commit message and is not pushed.
