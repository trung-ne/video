import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const PROJECT_CHUNK_LOCK_HEARTBEAT_SECONDS = 30;
export const PROJECT_CHUNK_LOCK_STALE_MS = 5 * 60 * 1000;
const PROCESS_START_MATCH_TOLERANCE_MS = 2_500;
const CURRENT_PROCESS_START_EPOCH_MS = Date.now() - Math.round(process.uptime() * 1000);

export type ProjectChunkOperation =
  | "process-storyboard-chunks"
  | "assemble-storyboard-chunks"
  | "compile-storyboard";
export type ProjectChunkLockMode = "check" | "execute";

export interface ProjectChunkLockOptions {
  operation: ProjectChunkOperation;
  mode: ProjectChunkLockMode;
  requestedChunk?: string;
  runId?: string;
}

export interface ProjectChunkLockOwner {
  schemaVersion: 1;
  token: string;
  pid: number;
  procStart: number;
  runId: string;
  host: string;
  operation: ProjectChunkOperation;
  mode: ProjectChunkLockMode;
  requestedChunk: string | null;
  projectId: string;
  projectDir: string;
  acquiredAt: string;
  heartbeatSeconds: number;
}

interface RecoveryClaim {
  schemaVersion: 1;
  token: string;
  pid: number;
  procStart: number;
  host: string;
  targetOwnerToken: string;
  acquiredAt: string;
}

interface ParsedFile<T> {
  value?: T;
  issue?: string;
}

interface LockState {
  stale: boolean;
  reason: string;
}

export interface ProjectChunkLock {
  path: string;
  owner: ProjectChunkLockOwner;
  release: () => void;
}

export class ProjectChunkInterruptedError extends Error {
  readonly signalName: "SIGINT" | "SIGTERM";
  readonly exitCode: 130 | 143;
  readonly originalError?: unknown;

  constructor(signalName: "SIGINT" | "SIGTERM", originalError?: unknown) {
    super(`Chunk project mutation interrupted by ${signalName}.`);
    this.name = "ProjectChunkInterruptedError";
    this.signalName = signalName;
    this.exitCode = signalName === "SIGINT" ? 130 : 143;
    this.originalError = originalError;
  }
}

export function projectChunkLockPath(projectDir: string): string {
  return path.resolve(projectDir, "chunks", ".project-writer.lock");
}

function ownerPath(lockPath: string): string {
  return path.join(lockPath, "owner.json");
}

function processStartEpochMs(): number {
  return CURRENT_PROCESS_START_EPOCH_MS;
}

function makeRunId(operation: ProjectChunkOperation): string {
  return `${operation}-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function sameHost(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

function validateOwner(value: unknown, expectedProjectDir: string): value is ProjectChunkLockOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Partial<ProjectChunkLockOwner>;
  return owner.schemaVersion === 1
    && isNonEmptyString(owner.token)
    && Number.isInteger(owner.pid) && (owner.pid as number) > 0
    && typeof owner.procStart === "number" && Number.isFinite(owner.procStart) && owner.procStart > 0
    && isNonEmptyString(owner.runId)
    && isNonEmptyString(owner.host)
    && (owner.operation === "process-storyboard-chunks"
      || owner.operation === "assemble-storyboard-chunks"
      || owner.operation === "compile-storyboard")
    && (owner.mode === "check" || owner.mode === "execute")
    && (owner.requestedChunk === null || isNonEmptyString(owner.requestedChunk))
    && isNonEmptyString(owner.projectId)
    && isNonEmptyString(owner.projectDir) && samePath(owner.projectDir, expectedProjectDir)
    && isValidDate(owner.acquiredAt)
    && owner.heartbeatSeconds === PROJECT_CHUNK_LOCK_HEARTBEAT_SECONDS;
}

function validateRecoveryClaim(value: unknown): value is RecoveryClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Partial<RecoveryClaim>;
  return claim.schemaVersion === 1
    && isNonEmptyString(claim.token)
    && Number.isInteger(claim.pid) && (claim.pid as number) > 0
    && typeof claim.procStart === "number" && Number.isFinite(claim.procStart) && claim.procStart > 0
    && isNonEmptyString(claim.host)
    && isNonEmptyString(claim.targetOwnerToken)
    && isValidDate(claim.acquiredAt);
}

function readJsonFile<T>(filePath: string, validate: (value: unknown) => value is T): ParsedFile<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return { issue: `cannot read ${filePath}: ${(error as NodeJS.ErrnoException).message}` };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed) ? { value: parsed } : { issue: `invalid metadata in ${filePath}` };
  } catch {
    return { issue: `invalid JSON in ${filePath}` };
  }
}

function readOwner(lockPath: string, expectedProjectDir: string): ParsedFile<ProjectChunkLockOwner> {
  return readJsonFile(ownerPath(lockPath), (value): value is ProjectChunkLockOwner => validateOwner(value, expectedProjectDir));
}

function processLiveness(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return "alive";
    if (code === "ESRCH") return "dead";
    return "unknown";
  }
}

function parsePositiveNumber(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function windowsProcessStartEpochMs(pid: number): number | undefined {
  const command = `$ErrorActionPreference = 'Stop'; $p = Get-Process -Id ${pid} -ErrorAction Stop; `
    + "([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()";
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command,
  ], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return parsePositiveNumber(result.stdout);
}

function linuxProcessStartEpochMs(pid: number): number | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingParen = stat.lastIndexOf(")");
    if (closingParen < 0) return undefined;
    const fieldsAfterCommand = stat.slice(closingParen + 1).trim().split(/\s+/);
    const startTicks = parsePositiveNumber(fieldsAfterCommand[19] ?? "");
    const procStat = fs.readFileSync("/proc/stat", "utf8");
    const bootMatch = /^btime\s+(\d+)$/m.exec(procStat);
    const bootSeconds = bootMatch ? parsePositiveNumber(bootMatch[1]) : undefined;
    const clockResult = spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8", timeout: 2_000 });
    const clockTicks = !clockResult.error && clockResult.status === 0
      ? parsePositiveNumber(clockResult.stdout)
      : undefined;
    if (startTicks === undefined || bootSeconds === undefined || clockTicks === undefined) return undefined;
    return bootSeconds * 1000 + (startTicks / clockTicks) * 1000;
  } catch {
    return undefined;
  }
}

function posixProcessStartEpochMs(pid: number): number | undefined {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 2_000,
  });
  if (result.error || result.status !== 0) return undefined;
  const parsed = Date.parse(result.stdout.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function actualProcessStartEpochMs(pid: number): number | undefined {
  if (pid === process.pid) return CURRENT_PROCESS_START_EPOCH_MS;
  if (process.platform === "win32") return windowsProcessStartEpochMs(pid);
  if (process.platform === "linux") return linuxProcessStartEpochMs(pid);
  return posixProcessStartEpochMs(pid);
}

function heartbeatAgeMs(filePath: string): number | undefined {
  try {
    const age = Date.now() - fs.statSync(filePath).mtimeMs;
    return Number.isFinite(age) ? Math.max(0, age) : undefined;
  } catch {
    return undefined;
  }
}

function classifyOwner(host: string, pid: number, procStart: number, heartbeatPath: string): LockState {
  if (sameHost(host, os.hostname())) {
    const liveness = processLiveness(pid);
    if (liveness === "dead") return { stale: true, reason: `local owner pid=${pid} is no longer alive` };
    if (liveness === "alive") {
      const actualStart = actualProcessStartEpochMs(pid);
      if (actualStart === undefined) {
        return {
          stale: false,
          reason: `local owner pid=${pid} is alive but its process-start identity could not be established safely`,
        };
      }
      const startDeltaMs = Math.abs(actualStart - procStart);
      if (startDeltaMs > PROCESS_START_MATCH_TOLERANCE_MS) {
        return {
          stale: true,
          reason: `local owner pid=${pid} was recycled (process-start identity differs by ${Math.round(startDeltaMs)}ms)`,
        };
      }
      return {
        stale: false,
        reason: `local owner pid=${pid} is alive with matching process-start identity; heartbeat age cannot displace it`,
      };
    }
    return { stale: false, reason: `local owner pid=${pid} liveness could not be established safely` };
  }

  const ageMs = heartbeatAgeMs(heartbeatPath);
  if (ageMs === undefined) {
    return { stale: false, reason: "foreign-host heartbeat age could not be established safely" };
  }
  if (ageMs > PROJECT_CHUNK_LOCK_STALE_MS) {
    return { stale: true, reason: `foreign-host heartbeat is ${Math.round(ageMs / 1000)}s old` };
  }
  return { stale: false, reason: `foreign-host heartbeat is only ${Math.round(ageMs / 1000)}s old` };
}

function ownerSummary(owner: ProjectChunkLockOwner): string {
  const chunk = owner.requestedChunk ? `, chunk=${owner.requestedChunk}` : "";
  return `operation=${owner.operation}, mode=${owner.mode}${chunk}, pid=${owner.pid}, host=${owner.host}, run=${owner.runId}, acquired=${owner.acquiredAt}`;
}

function activeLockError(lockPath: string, owner: ProjectChunkLockOwner, reason: string): Error {
  return new Error(
    `Chunk project mutation already in progress. Lock: ${lockPath}. Owner ${ownerSummary(owner)}. ${reason}.`,
  );
}

function unsafeLockError(lockPath: string, issue: string): Error {
  return new Error(
    `Chunk project lock cannot be recovered safely. Lock: ${lockPath}. ${issue}. `
    + "The lock was left intact for manual inspection.",
  );
}

function writeExclusiveJson(filePath: string, value: unknown): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx");
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function createOwnedLock(lockPath: string, owner: ProjectChunkLockOwner): void {
  fs.mkdirSync(lockPath);
  const temporaryOwnerPath = path.join(lockPath, `owner.${owner.token}.tmp`);
  try {
    writeExclusiveJson(temporaryOwnerPath, owner);
    fs.renameSync(temporaryOwnerPath, ownerPath(lockPath));
  } catch (error) {
    fs.rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }
}

function removeRecoveryClaimIfOwned(claimPath: string, token: string): void {
  const parsed = readJsonFile(claimPath, validateRecoveryClaim);
  if (parsed.value?.token === token) fs.rmSync(claimPath, { force: true });
}

function acquireRecoveryClaim(
  lockPath: string,
  staleOwner: ProjectChunkLockOwner,
  contender: ProjectChunkLockOwner,
): RecoveryClaim {
  const claimPath = path.join(lockPath, ".reclaim.json");
  const claim: RecoveryClaim = {
    schemaVersion: 1,
    token: contender.token,
    pid: process.pid,
    procStart: contender.procStart,
    host: contender.host,
    targetOwnerToken: staleOwner.token,
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeExclusiveJson(claimPath, claim);
      return claim;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = readJsonFile(claimPath, validateRecoveryClaim);
      if (!existing.value) throw unsafeLockError(lockPath, existing.issue ?? "invalid stale-recovery metadata");
      const state = classifyOwner(existing.value.host, existing.value.pid, existing.value.procStart, claimPath);
      if (!state.stale) {
        throw new Error(`Chunk project lock recovery already in progress. Lock: ${lockPath}. ${state.reason}.`);
      }
      removeRecoveryClaimIfOwned(claimPath, existing.value.token);
    }
  }
  throw new Error(`Could not claim stale chunk project lock recovery at ${lockPath}.`);
}

function reclaimStaleLock(
  lockPath: string,
  projectDir: string,
  staleOwner: ProjectChunkLockOwner,
  contender: ProjectChunkLockOwner,
): boolean {
  const claim = acquireRecoveryClaim(lockPath, staleOwner, contender);
  const claimPath = path.join(lockPath, ".reclaim.json");
  const current = readOwner(lockPath, projectDir);
  if (!current.value) {
    removeRecoveryClaimIfOwned(claimPath, claim.token);
    throw unsafeLockError(lockPath, current.issue ?? "owner metadata disappeared during stale recovery");
  }
  if (current.value.token !== staleOwner.token) {
    removeRecoveryClaimIfOwned(claimPath, claim.token);
    return false;
  }
  const currentState = classifyOwner(current.value.host, current.value.pid, current.value.procStart, ownerPath(lockPath));
  if (!currentState.stale) {
    removeRecoveryClaimIfOwned(claimPath, claim.token);
    throw activeLockError(lockPath, current.value, currentState.reason);
  }

  const quarantinePath = `${lockPath}.stale-${staleOwner.token}-${contender.token}`;
  try {
    fs.renameSync(lockPath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    removeRecoveryClaimIfOwned(claimPath, claim.token);
    throw error;
  }

  try {
    createOwnedLock(lockPath, contender);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fs.rmSync(quarantinePath, { recursive: true, force: true });
      return false;
    }
    if (!fs.existsSync(lockPath)) {
      try { fs.renameSync(quarantinePath, lockPath); }
      catch { /* Preserve the quarantine for manual recovery if restoration fails. */ }
    }
    throw error;
  }

  fs.rmSync(quarantinePath, { recursive: true, force: true });
  console.warn(`Cleared stale chunk project lock at ${lockPath} (${currentState.reason}).`);
  return true;
}

function attachLockLifecycle(lockPath: string, projectDir: string, owner: ProjectChunkLockOwner): ProjectChunkLock {
  let heartbeatWarningPrinted = false;
  const heartbeat = setInterval(() => {
    const current = readOwner(lockPath, projectDir);
    if (current.value?.token !== owner.token) return;
    try {
      const now = new Date();
      fs.utimesSync(ownerPath(lockPath), now, now);
    } catch (error) {
      if (!heartbeatWarningPrinted) {
        heartbeatWarningPrinted = true;
        console.error(`Could not refresh chunk project lock heartbeat at ${lockPath}: ${(error as Error).message}`);
      }
    }
  }, owner.heartbeatSeconds * 1000);
  heartbeat.unref();

  let released = false;
  const onExit = () => {
    try { release(); }
    catch { /* Exit cleanup is best-effort and must not throw from the exit event. */ }
  };
  function release(): void {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    process.removeListener("exit", onExit);
    const current = readOwner(lockPath, projectDir);
    if (current.value?.token === owner.token
      && current.value.pid === owner.pid
      && current.value.procStart === owner.procStart) {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }
  process.once("exit", onExit);
  return { path: lockPath, owner, release };
}

export function acquireProjectChunkLock(projectDir: string, options: ProjectChunkLockOptions): ProjectChunkLock {
  const absoluteProjectDir = path.resolve(projectDir);
  let projectStat: fs.Stats;
  try {
    projectStat = fs.statSync(absoluteProjectDir);
  } catch {
    throw new Error(`Cannot lock missing chunk project directory: ${absoluteProjectDir}`);
  }
  if (!projectStat.isDirectory()) throw new Error(`Cannot lock non-directory chunk project path: ${absoluteProjectDir}`);

  const lockPath = projectChunkLockPath(absoluteProjectDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const owner: ProjectChunkLockOwner = {
    schemaVersion: 1,
    token: crypto.randomUUID(),
    pid: process.pid,
    procStart: processStartEpochMs(),
    runId: options.runId ?? makeRunId(options.operation),
    host: os.hostname(),
    operation: options.operation,
    mode: options.mode,
    requestedChunk: options.requestedChunk ?? null,
    projectId: path.basename(absoluteProjectDir),
    projectDir: absoluteProjectDir,
    acquiredAt: new Date().toISOString(),
    heartbeatSeconds: PROJECT_CHUNK_LOCK_HEARTBEAT_SECONDS,
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      createOwnedLock(lockPath, owner);
      return attachLockLifecycle(lockPath, absoluteProjectDir, owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    let lockStat: fs.Stats;
    try {
      lockStat = fs.lstatSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!lockStat.isDirectory()) throw unsafeLockError(lockPath, "lock path is not a directory");

    const existing = readOwner(lockPath, absoluteProjectDir);
    if (!existing.value) throw unsafeLockError(lockPath, existing.issue ?? "owner metadata is unavailable");
    const state = classifyOwner(
      existing.value.host,
      existing.value.pid,
      existing.value.procStart,
      ownerPath(lockPath),
    );
    if (!state.stale) throw activeLockError(lockPath, existing.value, state.reason);
    if (reclaimStaleLock(lockPath, absoluteProjectDir, existing.value, owner)) {
      return attachLockLifecycle(lockPath, absoluteProjectDir, owner);
    }
  }
  throw new Error(`Could not acquire chunk project lock after concurrent stale recovery. Lock: ${lockPath}.`);
}

export async function runWithProjectChunkLock<T>(
  projectDir: string,
  options: ProjectChunkLockOptions,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abortController = new AbortController();
  let interruptedBy: "SIGINT" | "SIGTERM" | undefined;
  const interrupt = (signalName: "SIGINT" | "SIGTERM") => {
    interruptedBy ??= signalName;
    abortController.abort();
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  let lock: ProjectChunkLock | undefined;
  try {
    if (interruptedBy) throw new ProjectChunkInterruptedError(interruptedBy);
    lock = acquireProjectChunkLock(projectDir, options);
    const result = await task(abortController.signal);
    if (interruptedBy) throw new ProjectChunkInterruptedError(interruptedBy);
    return result;
  } catch (error) {
    if (interruptedBy && !(error instanceof ProjectChunkInterruptedError)) {
      throw new ProjectChunkInterruptedError(interruptedBy, error);
    }
    throw error;
  } finally {
    lock?.release();
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}
