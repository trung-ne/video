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
    const sameHost = owner?.host === os.hostname();
    const ownerAlive = Boolean(owner && sameHost && processIsAlive(owner.pid));
    const heartbeatStale = heartbeatAgeMs > 5 * 60 * 1000;
    // Synchronous Remotion/FFmpeg children can block Node's heartbeat timer for
    // much longer than five minutes. A locally-owned lock is therefore live for
    // as long as its PID is live; heartbeat age is only useful for another host.
    const stale = owner ? (sameHost ? !ownerAlive : heartbeatStale) : heartbeatStale;
    if (!stale) {
      throw new Error(
        `Render already in progress. Lock: ${lockPath}. ` +
        `Owner pid=${owner?.pid}, run=${owner?.runId}. ` +
        (sameHost
          ? "A live local owner cannot be displaced by a stale heartbeat."
          : "A foreign-host lock is cleared only after its heartbeat is older than 5 minutes.")
      );
    }
    console.warn(
      `Clearing stale render lock at ${lockPath} ` +
      `(${sameHost ? "owner process is dead" : "foreign-host heartbeat is older than 5 minutes"}).`
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
  const onExit = () => release();
  const onSigint = () => { release(); process.exit(130); };
  const onSigterm = () => { release(); process.exit(143); };
  function release() {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    process.removeListener("exit", onExit);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    const current = readOwner(ownerPath);
    if (current?.pid === process.pid && current.procStart === owner.procStart) {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }
  process.once("exit", onExit);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  return { path: lockPath, release };
}
