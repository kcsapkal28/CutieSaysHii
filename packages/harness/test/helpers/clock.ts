import type { Clock } from "../../src/kernel/ports.ts";

type Timer = { id: number; dueAt: number; fire: () => void };

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Manual time. `advance` fires due timers in order and lets their continuations run before moving on. */
export class FakeClock implements Clock {
  #now: number;
  #nextId = 1;
  readonly #timers = new Map<number, Timer>();

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.#timers.delete(id);
        reject(signal?.reason);
      };
      const id = this.#schedule(ms, () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  every(ms: number, fn: () => void): () => void {
    if (!(ms > 0)) throw new RangeError(`every needs a positive interval, got ${ms}`);
    let id = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      id = this.#schedule(ms, tick);
      fn();
    };
    id = this.#schedule(ms, tick);
    return () => {
      stopped = true;
      this.#timers.delete(id);
    };
  }

  async advance(ms: number): Promise<void> {
    const target = this.#now + ms;
    for (;;) {
      await flushMicrotasks();
      const next = [...this.#timers.values()]
        .filter((t) => t.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
      if (!next) break;
      this.#timers.delete(next.id);
      this.#now = next.dueAt;
      next.fire();
    }
    this.#now = target;
    await flushMicrotasks();
  }

  pendingTimers(): number {
    return this.#timers.size;
  }

  #schedule(ms: number, fire: () => void): number {
    const id = this.#nextId++;
    this.#timers.set(id, { id, dueAt: this.#now + Math.max(0, ms), fire });
    return id;
  }
}
