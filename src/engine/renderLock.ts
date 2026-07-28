import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface LockOwner {
  schemaVersion: 1;
  pid: number;
  procStart: number;
  runId: string;
  host: string;
  acquiredAt: string;
  heartbeatSeconds: number;
}

export interface RenderLock {
  path: string;
  release: () => void;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(ownerPath: string): LockOwner | undefined {
  try {
    return JSON.parse(fs.readFileSync(ownerPath, "utf8")) as LockOwner;
  } catch {
    return undefined;
  }
}

export function acquireRenderLock(finalDir: string, runId: string): RenderLock {
  const lockPath = path.resolve(finalDir, ".runs", ".lock");
  const ownerPath = path.join(lockPath, "owner.json");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = readOwner(ownerPath);
    const heartbeatAgeMs = fs.existsSync(ownerPath)
      ? Date.now() - fs.statSync(ownerPath).mtimeMs
      : Number.POSITIVE_INFINITY;
    const dead = owner ? !processIsAlive(owner.pid) : true;
    const heartbeatStale = heartbeatAgeMs > 5 * 60 * 1000;
    if (!dead && !heartbeatStale) {
      throw new Error(
        `Render already in progress. Lock: ${lockPath}. ` +
        `Owner pid=${owner?.pid}, run=${owner?.runId}. ` +
        "The lock is cleared only when its process is dead or its heartbeat is older than 5 minutes."
      );
    }
    console.warn(
      `Clearing stale render lock at ${lockPath} ` +
      `(${dead ? "owner process is dead" : "heartbeat is older than 5 minutes"}).`
    );
    fs.rmSync(lockPath, { recursive: true, force: true });
    fs.mkdirSync(lockPath);
  }

  const owner: LockOwner = {
    schemaVersion: 1,
    pid: process.pid,
    procStart: Date.now() - Math.round(process.uptime() * 1000),
    runId,
    host: os.hostname(),
    acquiredAt: new Date().toISOString(),
    heartbeatSeconds: 30,
  };
  fs.writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  const heartbeat = setInterval(() => {
    const current = readOwner(ownerPath);
    if (current?.pid === process.pid && current.procStart === owner.procStart) {
      fs.utimesSync(ownerPath, new Date(), new Date());
    }
  }, owner.heartbeatSeconds * 1000);
  heartbeat.unref();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    const current = readOwner(ownerPath);
    if (current?.pid === process.pid && current.procStart === owner.procStart) {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  };
  process.once("exit", release);
  process.once("SIGINT", () => { release(); process.exit(130); });
  process.once("SIGTERM", () => { release(); process.exit(143); });
  return { path: lockPath, release };
}
