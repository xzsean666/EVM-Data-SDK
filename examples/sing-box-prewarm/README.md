# sing-box prewarm consumer example

This is a standalone Node 24 / pnpm 11 consumer project. It separates the two
networked stages deliberately:

1. `pnpm add` downloads the SDK package through an optional HTTP(S) proxy.
2. `pnpm run prewarm:sing-box` downloads one pinned sing-box release through
   that proxy, verifies the release archive SHA-256, and installs the executable
   beneath this application's `.tools/` directory.

The application then passes that explicit `binaryPath` to `EvmDataClient` with
`downloadMode: "eager"`. Once prewarming has succeeded, application startup
does not need access to GitHub to obtain sing-box. The SDK starts only the local
verified binary and routes provider requests through its loopback proxy.

No credentials, proxy URLs, VLESS URLs, or sing-box binaries are committed by
this example. `.tools/` and `node_modules/` are ignored.

## Install the SDK through an HTTP proxy

Use a pinned Git commit or release tag in a production project. A GitHub source
dependency needs its `prepare` build during installation, so create the narrow
pnpm build allowlist before installing it. `main` is only convenient for trying
the example; it is not a reproducible deployment reference.

```bash
mkdir evm-sing-box-consumer
cd evm-sing-box-consumer
pnpm init
cat > pnpm-workspace.yaml <<'YAML'
packages: []
allowBuilds:
  "evm-data-sdk@git+https://github.com/xzsean666/EVM-Data-SDK.git": true
YAML

export EVM_INSTALL_PROXY='http://proxy-user:proxy-password@proxy-host:proxy-port/'
export HTTP_PROXY="$EVM_INSTALL_PROXY"
export HTTPS_PROXY="$EVM_INSTALL_PROXY"
export http_proxy="$EVM_INSTALL_PROXY"
export https_proxy="$EVM_INSTALL_PROXY"

pnpm add "github:xzsean666/EVM-Data-SDK#<immutable-commit-or-release-tag>"
```

`pnpm` and Git use these standard proxy environment variables for dependency
installation. The allowlist lets this exact known GitHub repository run its
`prepare` build and produce `dist/`; it does not approve arbitrary transitive
lifecycle scripts. Do not put the proxy URL in `package.json`, a lockfile,
source code, or CI logs.

To run this repository's ready-made example, copy this directory or change into
it, choose a pinned dependency revision, then run the following with the same
HTTP(S) proxy variables still exported:

```bash
pnpm install
```

Because this example lives beneath the SDK repository's workspace, its own
`pnpm-workspace.yaml` keeps the command independent from the parent workspace.
Commit the resulting `pnpm-lock.yaml` in your consuming application after
reviewing the selected immutable SDK revision. The reusable example deliberately
does not commit a lockfile that would pin an unrelated historical `main` commit.

## Prewarm and verify sing-box in CI or deployment

The SDK's explicit `prewarmSingBox()` API uses Node's built-in `fetch`, which
needs environment-proxy support enabled at process startup. With Node 24, set
`NODE_USE_ENV_PROXY=1` for the prewarm command:

```bash
NODE_USE_ENV_PROXY=1 pnpm run prewarm:sing-box
```

The SDK selects the matching `1.13.16` Linux/macOS/Windows x64 or arm64 asset,
verifies its pinned SHA-256 before extraction, rejects unsafe archive paths, and
installs a user-only executable on Unix. It is idempotent: a verified local
result is reused. The host needs `tar` for `.tar.gz` assets, or `unzip` for
Windows `.zip` assets.

For a CI cache outside the workspace, use a controlled path:

```bash
SING_BOX_CACHE_DIR="$PWD/.ci-cache/sing-box" NODE_USE_ENV_PROXY=1 pnpm run prewarm:sing-box
```

Save that verified cache as a CI artifact or image layer. On the runtime host,
restore it and provide the same `SING_BOX_CACHE_DIR` (or set
`SING_BOX_BINARY_PATH` to the installed executable). The example's default
location is `.tools/sing-box/1.13.16/<platform>-<arch>/sing-box`.

## Run only after prewarming

The sample makes one Etherscan balance request through a VLESS endpoint. It
never falls back to a direct route (`allowDirect: false`). Supply values through
the deployment secret store, not a tracked file:

```bash
export EVM_DATA_SDK_VLESS_URL='vless://…'
export ETHERSCAN_API_KEY='…'
pnpm start
```

After the prewarm command, unset the external download-proxy variables before
application startup if they are not otherwise needed. The SDK will use the
loopback HTTP endpoint created by sing-box; it does not use the HTTP download
proxy for provider requests.

## Guarantee and boundary

Installing `evm-data-sdk` alone cannot guarantee an external executable is
already present unless the package either embeds the binary or performs an
implicit `postinstall` download. This example intentionally uses an explicit,
auditable CI/deployment prewarm step instead: network failure prevents a broken
artifact from being promoted, rather than surfacing as a first-request runtime
failure.
