import { spawn } from "child_process";

export const STATUS_DLL_INIT_FAILED = 0xC0000142;

export type ProcessAttempt = {
  phase: string;
  attempt: number;
  executable: string;
  args: string[];
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  exitCode: number | null;
  windowsStatus: number | null;
  windowsStatusHex: string | null;
  signal: NodeJS.Signals | null;
  spawnError: { code?: string; message: string } | null;
  stderrTail: string;
};

export class ProcessRunError extends Error {
  constructor(public readonly result: ProcessAttempt) {
    super(describeProcessFailure(result));
    this.name = "ProcessRunError";
  }
}

function statusFromExitCode(exitCode: number | null): number | null {
  if (exitCode === null) return null;
  // Node can expose a Windows NTSTATUS either as a signed 32-bit number or an
  // unsigned JavaScript number, depending on the executable and host shell.
  return exitCode >>> 0;
}

function statusHex(status: number | null): string | null {
  return status === null ? null : `0x${status.toString(16).toUpperCase().padStart(8, "0")}`;
}

function describeProcessFailure(result: ProcessAttempt): string {
  const detail = result.spawnError
    ? `${result.spawnError.code ? `${result.spawnError.code}: ` : ""}${result.spawnError.message}`
    : result.signal
      ? `terminated by ${result.signal}`
      : `exited with ${result.exitCode}${result.windowsStatusHex ? ` (${result.windowsStatusHex})` : ""}`;
  const tail = result.stderrTail ? `\nstderr tail:\n${result.stderrTail}` : "";
  return `${result.phase} failed: ${detail}.${tail}`;
}

function appendTail(previous: string, chunk: string, maxChars: number): string {
  const next = previous + chunk;
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

export function isDllInitFailure(result: ProcessAttempt): boolean {
  return result.windowsStatus === STATUS_DLL_INIT_FAILED;
}

export async function runProcess(options: {
  phase: string;
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  attempt?: number;
  stderrTailChars?: number;
}): Promise<ProcessAttempt> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const maxTail = options.stderrTailChars ?? 8_192;
  let stderrTail = "";

  return new Promise<ProcessAttempt>((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: false,
      stdio: ["ignore", "inherit", "pipe"],
    });
    let spawnError: { code?: string; message: string } | null = null;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      process.stderr.write(text);
      stderrTail = appendTail(stderrTail, text, maxTail);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = { code: error.code, message: error.message };
    });
    child.on("close", (exitCode, signal) => {
      const windowsStatus = statusFromExitCode(exitCode);
      const finished = Date.now();
      const result: ProcessAttempt = {
        phase: options.phase,
        attempt: options.attempt ?? 1,
        executable: options.executable,
        args: [...options.args],
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        elapsedMs: finished - started,
        exitCode,
        windowsStatus,
        windowsStatusHex: statusHex(windowsStatus),
        signal,
        spawnError,
        stderrTail,
      };
      if (spawnError || exitCode !== 0 || signal) reject(new ProcessRunError(result));
      else resolve(result);
    });
  });
}

export async function runProcessWithDllInitRetry(options: Parameters<typeof runProcess>[0] & {
  retryDllInitFailure?: boolean;
  beforeRetry?: () => void | Promise<void>;
  retryDelayMs?: number;
}): Promise<ProcessAttempt[]> {
  const results: ProcessAttempt[] = [];
  for (let attempt = 1; attempt <= (options.retryDllInitFailure ? 2 : 1); attempt += 1) {
    try {
      results.push(await runProcess({ ...options, attempt }));
      return results;
    } catch (error) {
      if (!(error instanceof ProcessRunError)) throw error;
      results.push(error.result);
      if (attempt !== 1 || !options.retryDllInitFailure || !isDllInitFailure(error.result)) throw error;
      await options.beforeRetry?.();
      await new Promise<void>((resolve) => setTimeout(resolve, options.retryDelayMs ?? 1_000));
    }
  }
  throw new Error("Unreachable process retry state.");
}
