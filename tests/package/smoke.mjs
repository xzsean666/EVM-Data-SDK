import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "evm-data-sdk-package-"));

function run(command, argumentsList) {
  execFileSync(command, argumentsList, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}

try {
  run("pnpm", ["pack", "--pack-destination", temporaryDirectory]);

  const tarballs = (await readdir(temporaryDirectory)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error("Expected pnpm pack to create exactly one tarball.");
  }

  const tarball = tarballs[0];
  if (tarball === undefined) {
    throw new Error("Package tarball was not found.");
  }

  const extractedDirectory = path.join(temporaryDirectory, "extracted");
  await mkdir(extractedDirectory, { recursive: true });
  run("tar", ["-xzf", path.join(temporaryDirectory, tarball), "-C", extractedDirectory]);

  const packageDirectory = path.join(extractedDirectory, "package");
  const packageEntries = await readdir(packageDirectory);
  const unexpectedEntries = packageEntries.filter(
    (entry) => entry !== "dist" && entry !== "package.json" && entry !== "README.md",
  );
  if (unexpectedEntries.length > 0) {
    throw new Error(
      `Tarball contains unexpected top-level entries: ${unexpectedEntries.join(", ")}`,
    );
  }

  const packagedFiles = await listFiles(packageDirectory);
  const forbiddenPackagedFiles = packagedFiles.filter((entry) =>
    /(?:^|\/)(?:tests?|fixtures?|scripts?|\.env(?:\.|$)|Agent\.md|docs(?:\/|$))/i.test(entry),
  );
  if (forbiddenPackagedFiles.length > 0) {
    throw new Error(`Tarball contains repository-only files: ${forbiddenPackagedFiles.join(", ")}`);
  }
  const forbiddenContent = ["secret-key", "provider-cursor-secret", "proxy-password-secret"];
  for (const entry of packagedFiles) {
    const content = await readFile(path.join(packageDirectory, entry), "utf8");
    const match = forbiddenContent.find((value) => content.includes(value));
    if (match !== undefined) {
      throw new Error(`Tarball contains a known test secret: ${match}`);
    }
  }

  const packagedManifest = JSON.parse(
    await readFile(path.join(packageDirectory, "package.json"), "utf8"),
  );
  if (packagedManifest.exports?.["."]?.import !== "./dist/index.js") {
    throw new Error("Packaged ESM export does not target dist/index.js.");
  }
  if (packagedManifest.exports?.["."]?.require !== "./dist/index.cjs") {
    throw new Error("Packaged CommonJS export does not target dist/index.cjs.");
  }
  if (packagedManifest.exports?.["."]?.types !== "./dist/index.d.ts") {
    throw new Error("Packaged type export does not target dist/index.d.ts.");
  }

  const consumerDirectory = path.join(temporaryDirectory, "consumer");
  const consumerNodeModules = path.join(consumerDirectory, "node_modules");
  await mkdir(consumerNodeModules, { recursive: true });
  const packagedNodeModules = path.join(packageDirectory, "node_modules");
  await mkdir(packagedNodeModules, { recursive: true });
  await symlink(
    packageDirectory,
    path.join(consumerNodeModules, packagedManifest.name),
    "dir",
  );
  for (const dependency of ["axios", "zod"]) {
    await symlink(
      path.join(repositoryRoot, "node_modules", dependency),
      path.join(consumerNodeModules, dependency),
      "dir",
    );
    await symlink(
      path.join(repositoryRoot, "node_modules", dependency),
      path.join(packagedNodeModules, dependency),
      "dir",
    );
  }

  const esmConsumer = path.join(consumerDirectory, "esm-consumer.mjs");
  await writeFile(
    esmConsumer,
    'import * as sdk from "evm-data-sdk";\nif (typeof sdk !== "object" || typeof sdk.BlockscoutAdapter !== "function") throw new Error("ESM import failed");\n',
  );
  run(process.execPath, [esmConsumer]);

  const commonJsConsumer = path.join(consumerDirectory, "commonjs-consumer.cjs");
  await writeFile(
    commonJsConsumer,
    'const sdk = require("evm-data-sdk");\nif (typeof sdk !== "object") throw new Error("CommonJS import failed");\n',
  );
  run(process.execPath, [commonJsConsumer]);

  const typeScriptConsumer = path.join(consumerDirectory, "typescript-consumer.ts");
  const consumerTsconfig = path.join(consumerDirectory, "tsconfig.json");
  await writeFile(
    typeScriptConsumer,
    [
    'import { EvmDataClient, EvmDataError } from "evm-data-sdk";',
      'import type { BlockscoutConfiguration, ClientConfiguration, Page, Transaction } from "evm-data-sdk";',
      'const configuration: ClientConfiguration = { providers: [{ kind: "etherscan", apiKeys: ["test-key"] }] };',
      'const blockscoutConfiguration: BlockscoutConfiguration = { kind: "blockscout", apiKeys: ["test-key"], baseUrl: "https://eth.blockscout.com/api" };',
      'const transaction: Transaction = { chainId: 1, hash: "0x1234", blockNumber: "1", blockHash: null, transactionIndex: null, timestamp: null, from: "0x1234567890abcdef1234567890abcdef12345678", to: null, nonce: null, value: "0", gasLimit: null, gasUsed: null, gasPrice: null, input: null, status: "unknown", provider: "etherscan" };',
      'const page: Page<Transaction> = { items: [transaction], nextCursor: null, pageInfo: { provider: "etherscan", chainId: 1 } };',
      'const error = new EvmDataError({ code: "INVALID_REQUEST", message: "invalid", retryable: false });',
      'const client = new EvmDataClient(configuration);',
      'void configuration; void blockscoutConfiguration; void page; void error; void client;',
      '',
    ].join("\n"),
  );
  await writeFile(
    consumerTsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          skipLibCheck: true,
        },
        files: [typeScriptConsumer],
      },
      null,
      2,
    ),
  );
  run("pnpm", ["exec", "tsc", "--project", consumerTsconfig]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}
