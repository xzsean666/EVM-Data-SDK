import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

import { EvmDataError } from "../domain/errors";

export const SUPPORTED_SING_BOX_VERSION = "1.13.16";

interface ReleaseAsset {
  readonly assetName: string;
  readonly digest: string;
}

const releaseAssets: Readonly<Record<string, ReleaseAsset>> = Object.freeze({
  "darwin-x64": { assetName: "sing-box-1.13.16-darwin-amd64.tar.gz", digest: "2bfad58d034e280c773e194be03649555e5a7040c48b559dd0898ad293fe793d" },
  "darwin-arm64": { assetName: "sing-box-1.13.16-darwin-arm64.tar.gz", digest: "32fa21fd75ad62d86a2dcb7e0be77359c35e12798cdbb6a0e30654ef487d90d6" },
  "linux-x64": { assetName: "sing-box-1.13.16-linux-amd64.tar.gz", digest: "e37c312859dfa84cba148f41072ff6369f08361ae91d622dc1fd3aab49611a8d" },
  "linux-arm64": { assetName: "sing-box-1.13.16-linux-arm64.tar.gz", digest: "d587fb00bdc3c044227f35d15d154f271bc75108475091eda2542e4b82bb2949" },
  "win32-x64": { assetName: "sing-box-1.13.16-windows-amd64.zip", digest: "6cbf90ec4ee87122ffce09b73928fb31e763bc1c75a119f79c61d24734c78807" },
  "win32-arm64": { assetName: "sing-box-1.13.16-windows-arm64.zip", digest: "8412e9751a776a1cd5138fde8a6b60784af91b0fe596cba1b6efcd05144ef511" },
});

export interface SingBoxBinaryRequest {
  readonly version: string;
  readonly binaryPath?: string;
  readonly cacheDir?: string;
  readonly signal?: AbortSignal;
}

export interface SingBoxBinaryManagerOptions {
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly fetch?: typeof fetch;
  readonly cacheDir?: string;
}

/**
 * Explicitly prepares the fixed, verified sing-box executable for CI, image
 * builds, or deployment provisioning. It never runs during package install.
 */
export interface PrewarmSingBoxOptions {
  readonly version?: string;
  readonly binaryPath?: string;
  readonly cacheDir?: string;
  readonly signal?: AbortSignal;
}

/**
 * Downloads (when needed), verifies, and returns the local path to the pinned
 * sing-box binary. Set NODE_USE_ENV_PROXY=1 before Node starts when the release
 * download must use HTTP(S)_PROXY.
 */
export async function prewarmSingBox(options: PrewarmSingBoxOptions = {}): Promise<string> {
  return new SingBoxBinaryManager().resolve({
    version: options.version ?? SUPPORTED_SING_BOX_VERSION,
    ...(options.binaryPath === undefined ? {} : { binaryPath: options.binaryPath }),
    ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

/** Resolves only the pinned, checksum-verified sing-box release for this host. */
export class SingBoxBinaryManager {
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly defaultCacheDir: string;

  constructor(options: SingBoxBinaryManagerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    this.fetchImplementation = options.fetch ?? fetch;
    this.defaultCacheDir = options.cacheDir ?? join(homedir(), ".cache", "evm-data-sdk", "sing-box");
  }

  async resolve(request: SingBoxBinaryRequest): Promise<string> {
    const asset = this.asset(request.version);
    if (request.signal?.aborted === true) throw aborted();
    if (request.binaryPath !== undefined) {
      await verifyExecutable(request.binaryPath, this.platform);
      return request.binaryPath;
    }

    const cacheRoot = request.cacheDir ?? this.defaultCacheDir;
    const destinationDirectory = join(cacheRoot, request.version, this.platform + "-" + this.architecture);
    const destination = join(destinationDirectory, binaryName(this.platform));
    if (await isVerifiedExecutable(destination, this.platform)) return destination;

    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    const archive = join(await mkdtemp(join(tmpdir(), "evm-data-sdk-sing-box-download-")), asset.assetName);
    const extractionDirectory = join(dirname(archive), "extract");
    try {
      await downloadArchive(this.fetchImplementation, request.version, asset, archive, request.signal);
      await verifyDigest(archive, asset.digest);
      await extractArchive(archive, extractionDirectory, this.platform);
      const extractedBinary = await findExtractedBinary(extractionDirectory, this.platform);
      const temporaryDestination = destination + ".new-" + String(process.pid) + "-" + String(Date.now());
      await copyFile(extractedBinary, temporaryDestination);
      if (this.platform !== "win32") await chmod(temporaryDestination, 0o700);
      await verifyExecutable(temporaryDestination, this.platform);
      await rename(temporaryDestination, destination);
      return destination;
    } catch (error: unknown) {
      if (error instanceof EvmDataError) throw error;
      throw new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "Unable to prepare the pinned sing-box binary.", retryable: true, cause: error });
    } finally {
      await rm(dirname(archive), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private asset(version: string): ReleaseAsset {
    if (version !== SUPPORTED_SING_BOX_VERSION) {
      throw new EvmDataError({ code: "SING_BOX_VERSION_INVALID", message: "The configured sing-box version is not supported by this SDK release.", retryable: false });
    }
    const asset = releaseAssets[this.platform + "-" + this.architecture];
    if (asset === undefined) {
      throw new EvmDataError({ code: "SING_BOX_PLATFORM_UNSUPPORTED", message: "The current platform or architecture is not supported by the managed proxy runtime.", retryable: false });
    }
    return asset;
  }
}

async function downloadArchive(implementation: typeof fetch, version: string, asset: ReleaseAsset, destination: string, signal: AbortSignal | undefined): Promise<void> {
  let response: Response;
  try {
    response = await implementation(
      "https://github.com/SagerNet/sing-box/releases/download/v" + version + "/" + asset.assetName,
      signal === undefined ? {} : { signal },
    );
  } catch (error: unknown) {
    if (signal?.aborted === true) throw aborted();
    throw new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "Unable to download the pinned sing-box release.", retryable: true, cause: error });
  }
  if (!response.ok) {
    throw new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "The pinned sing-box release could not be downloaded.", retryable: response.status >= 500 || response.status === 429 });
  }
  const handle = await open(destination, "wx", 0o600);
  try {
    await handle.writeFile(new Uint8Array(await response.arrayBuffer()));
  } finally {
    await handle.close();
  }
}

async function verifyDigest(path: string, expected: string): Promise<void> {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== expected) {
    throw new EvmDataError({ code: "SING_BOX_CHECKSUM_MISMATCH", message: "The downloaded sing-box release failed checksum verification.", retryable: false });
  }
}

async function extractArchive(archive: string, directory: string, platform: NodeJS.Platform): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const zip = platform === "win32";
  const listed = await executeArchiveCommand(zip ? "unzip" : "tar", zip ? ["-Z1", archive] : ["-tzf", archive]);
  for (const entry of listed.split(/\r?\n/)) {
    if (entry !== "") assertSafeArchiveEntry(entry);
  }
  await executeArchiveCommand(zip ? "unzip" : "tar", zip ? ["-qq", archive, "-d", directory] : ["-xzf", archive, "-C", directory]);
}

function executeArchiveCommand(command: string, argumentsList: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...argumentsList], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", () => reject(new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "The local archive extractor is unavailable.", retryable: false })));
    child.once("close", (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "The downloaded sing-box archive could not be extracted.", retryable: false }));
    });
  });
}

function assertSafeArchiveEntry(entry: string): void {
  const normalized = entry.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((part) => part === "..")) {
    throw new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "The downloaded sing-box archive contains an unsafe path.", retryable: false });
  }
}

async function findExtractedBinary(directory: string, platform: NodeJS.Platform): Promise<string> {
  const expected = binaryName(platform);
  const matches: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name === expected) matches.push(candidate);
    }
  };
  await visit(directory);
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "The downloaded sing-box archive does not contain one usable executable.", retryable: false });
  }
  const candidate = resolve(matches[0]);
  if (!candidate.startsWith(resolve(directory) + sep)) {
    throw new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "The extracted sing-box executable path is unsafe.", retryable: false });
  }
  return candidate;
}

async function isVerifiedExecutable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await verifyExecutable(path, platform);
    if (platform !== "win32") await chmod(path, 0o700);
    return true;
  } catch {
    return false;
  }
}

async function verifyExecutable(path: string, platform: NodeJS.Platform): Promise<void> {
  try {
    const details = await stat(path);
    if (!details.isFile()) throw new Error("not a file");
    await access(path, platform === "win32" ? 0 : 1);
    const header = await readFile(path, { encoding: null, flag: "r" }).then((contents) => contents.subarray(0, 4));
    const recognized = platform === "win32"
      ? header[0] === 0x4d && header[1] === 0x5a
      : header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46 || header[0] === 0xcf && header[1] === 0xfa && header[2] === 0xed && header[3] === 0xfe || header[0] === 0xfe && header[1] === 0xed && header[2] === 0xfa && header[3] === 0xcf;
    if (!recognized) throw new Error("unrecognized executable");
  } catch (error: unknown) {
    throw new EvmDataError({ code: "SING_BOX_DOWNLOAD_FAILED", message: "The configured sing-box executable is unavailable or invalid.", retryable: false, cause: error });
  }
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "sing-box.exe" : "sing-box";
}

function aborted(): EvmDataError {
  return new EvmDataError({ code: "REQUEST_ABORTED", message: "Managed proxy initialization was aborted.", retryable: false });
}
