import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EvmDataError } from "../domain/errors";
import { buildSingBoxConfig, type SingBoxConfig } from "./SingBoxConfigBuilder";
import type { ParsedSingBoxProxy } from "./SingBoxUrlParser";

export interface SingBoxRuntimeOptions {
  readonly binaryPath: string;
  readonly nodes: readonly ParsedSingBoxProxy[];
  readonly startupTimeoutMs: number;
  readonly spawnProcess?: (command: string, argumentsList: readonly string[]) => ChildProcess;
}

/** Owns one ephemeral sing-box process and its secret configuration file. */
export class SingBoxRuntime {
  private readonly spawnProcess: (command: string, argumentsList: readonly string[]) => ChildProcess;
  private child: ChildProcess | null = null;
  private directory: string | null = null;
  private port: number | null = null;
  private started: Promise<string> | null = null;
  private closed = false;

  constructor(private readonly options: SingBoxRuntimeOptions) {
    this.spawnProcess = options.spawnProcess ?? ((command, argumentsList) => spawn(command, [...argumentsList], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    }));
  }

  async start(signal?: AbortSignal): Promise<string> {
    if (this.closed) throw proxyClosed();
    if (this.port !== null && this.child !== null && this.child.exitCode === null) {
      return localUrl(this.port);
    }
    this.started ??= this.startProcess(signal);
    return this.started;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = null;
    this.port = null;
    this.started = null;
    if (child !== null && child.exitCode === null) {
      await stopProcess(child);
    }
    const directory = this.directory;
    this.directory = null;
    if (directory !== null) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  private async startProcess(signal: AbortSignal | undefined): Promise<string> {
    try {
      if (signal?.aborted === true) throw aborted();
      const port = await reserveLoopbackPort();
      const directory = await mkdtemp(join(tmpdir(), "evm-data-sdk-sing-box-"));
      const configurationPath = join(directory, "config.json");
      const configuration: SingBoxConfig = buildSingBoxConfig(this.options.nodes, port);
      await writeFile(configurationPath, JSON.stringify(configuration), { encoding: "utf8", mode: 0o600, flag: "wx" });
      if (this.closed) throw proxyClosed();
      const child = this.spawnProcess(this.options.binaryPath, ["run", "-c", configurationPath]);
      this.child = child;
      this.directory = directory;
      this.port = port;
      // Consume stderr so a verbose child cannot block; never expose its raw text.
      child.stderr?.resume();
      await waitForReady(child, port, this.options.startupTimeoutMs, signal);
      if (this.closed) throw proxyClosed();
      return localUrl(port);
    } catch (error: unknown) {
      await this.failedStartCleanup();
      if (error instanceof EvmDataError) throw error;
      throw new EvmDataError({ code: "SING_BOX_START_FAILED", message: "The managed proxy runtime could not start.", retryable: true, cause: error });
    }
  }

  private async failedStartCleanup(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.port = null;
    this.started = null;
    if (child !== null && child.exitCode === null) await stopProcess(child);
    const directory = this.directory;
    this.directory = null;
    if (directory !== null) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("No loopback port was assigned.")));
        return;
      }
      server.close((error) => error === undefined ? resolvePromise(address.port) : reject(error));
    });
  });
}

async function waitForReady(child: ChildProcess, port: number, timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted === true) throw aborted();
    if (child.exitCode !== null || child.killed) {
      throw new EvmDataError({ code: "SING_BOX_EXITED", message: "The managed proxy runtime exited before it became ready.", retryable: true });
    }
    if (await canConnect(port)) return;
    await wait(40, signal);
  }
  throw new EvmDataError({ code: "SING_BOX_START_TIMEOUT", message: "The managed proxy runtime did not become ready before its startup timeout.", retryable: true });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePromise(false); });
    socket.once("error", () => { socket.destroy(); resolvePromise(false); });
  });
}

function wait(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolvePromise();
    };
    const timeout = setTimeout(finish, milliseconds);
    const cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      reject(aborted());
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    new Promise<boolean>((resolvePromise) => child.once("close", () => resolvePromise(true))),
    new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), 2_000)),
  ]);
  if (!stopped && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(resolvePromise, 2_000);
      child.once("close", () => { clearTimeout(timeout); resolvePromise(); });
    });
  }
}

function localUrl(port: number): string {
  return "http://127.0.0.1:" + String(port);
}

function aborted(): EvmDataError {
  return new EvmDataError({ code: "REQUEST_ABORTED", message: "Managed proxy initialization was aborted.", retryable: false });
}

function proxyClosed(): EvmDataError {
  return new EvmDataError({ code: "PROXY_ERROR", message: "The managed proxy runtime is closed.", retryable: false });
}
