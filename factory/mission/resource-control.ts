import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Resource control — single-Studio policy + project-level serialization.
 *
 * Rules enforced here (offline-safe, no Studio dependency):
 * - NEVER intentionally launch multiple Roblox Studio instances for one task.
 * - Serialize conflicting mutations to the same Roblox project.
 * - Bound concurrent heavy agent executions.
 *
 * Implemented as filesystem locks under <baseDir>/outputs/locks so every
 * runner (Mission, TaskRunner, CLI) shares the same mutual exclusion
 * without a live Studio connection.
 */

export interface LockHandle {
  name: string;
  path: string;
  release(): Promise<void>;
}

export function studioLockName(): string {
  return "roblox-studio-singleton";
}

export function projectLockName(projectDir: string): string {
  return `project-${projectDir.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80)}`;
}

export async function acquireLock(baseDir: string, name: string): Promise<LockHandle | null> {
  const dir = path.join(baseDir, "outputs", "locks");
  await fs.mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, `${name}.lock`);
  try {
    const fd = await fs.open(lockPath, "wx");
    await fd.write(`${process.pid}\n`);
    await fd.close();
    let released = false;
    return {
      name,
      path: lockPath,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await fs.unlink(lockPath);
        } catch {
          // already released
        }
      },
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err;
  }
}

/** True when another process currently holds the Studio singleton lock. */
export async function studioLockHeld(baseDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(baseDir, "outputs", "locks", `${studioLockName()}.lock`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `fn` while holding the named lock. Returns null when the lock is
 * contended (caller must queue/retry rather than open a second Studio or
 * mutate the same project concurrently).
 */
export async function withLock<T>(
  baseDir: string,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const handle = await acquireLock(baseDir, name);
  if (!handle) return null;
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

/** Bounded agent concurrency gate (semaphore-lite, in-process). */
export class ConcurrencyGate {
  private running = 0;
  constructor(private readonly max: number = 3) {}

  get inFlight(): number {
    return this.running;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      throw new Error(`concurrency budget exhausted (${this.running}/${this.max}) — queue instead of parallelizing`);
    }
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
    }
  }
}
