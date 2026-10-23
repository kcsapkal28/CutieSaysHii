import type { Clock } from "../../src/kernel/ports.ts";

type Timer = { id: number; dueAt: number; fire: () => void };

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Manual time. `advance` and `runUntilIdle` fire due timers in order; before each one they let
 * continuations run and wait for every `track`ed I/O promise, so fake time moves only when the
 * code is waiting on time.
 */
export class FakeClock implements Clock {
  #now: number;
  #nextId = 1;
  readonly #timers = new Map<number, Timer>();
  readonly #tracked = new Set<Promise<unknown>>();
  readonly #settleTimeoutMs: number;

  /** `settleTimeoutMs`: real time to wait for tracked I/O before failing (it may be waiting on fake time). */
  constructor(start = 0, { settleTimeoutMs = 5_000 }: { settleTimeoutMs?: number } = {}) {
    this.#now = start;
    this.#settleTimeoutMs = settleTimeoutMs;
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

  /** Marks real I/O (a file write, a rename) that must settle before the next timer fires. */
  track<T>(p: Promise<T>): Promise<T> {
    this.#tracked.add(p);
    const untrack = () => void this.#tracked.delete(p);
    p.then(untrack, untrack);
    return p;
  }

  async advance(ms: number): Promise<void> {
    const target = this.#now + ms;
    for (;;) {
      await this.#settle();
      const next = this.#earliest(target);
      if (!next) break;
      this.#timers.delete(next.id);
      this.#now = next.dueAt;
      next.fire();
    }
    this.#now = target;
    await this.#settle();
  }

  /**
   * Fires every pending timer in due order, settling tracked I/O before each one. `ioGraceMs` adds
   * real time on top, as a fallback for I/O nobody tracks. Throws after `maxTimers` firings, which
   * means a repeating timer is still running.
   */
  async runUntilIdle({ ioGraceMs = 0, maxTimers = 200 }: { ioGraceMs?: number; maxTimers?: number } = {}): Promise<void> {
    for (let fired = 0; ; fired++) {
      await this.#settle();
      if (ioGraceMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, ioGraceMs));
        await this.#settle();
      }
      const next = this.#earliest(Infinity);
      if (!next) return;
      if (fired >= maxTimers) throw new Error(`runUntilIdle: timers still pending after ${maxTimers} timers (a running every()?)`);
      this.#timers.delete(next.id);
      this.#now = Math.max(this.#now, next.dueAt);
      next.fire();
    }
  }

  pendingTimers(): number {
    return this.#timers.size;
  }

  /** Flushes continuations until no tracked I/O is pending; I/O tracked meanwhile is waited for too. */
  async #settle(): Promise<void> {
    for (;;) {
      await flushMicrotasks();
      if (this.#tracked.size === 0) return;
      let guard: ReturnType<typeof setTimeout> | undefined;
      const stuck = new Promise<"stuck">((resolve) => {
        guard = setTimeout(() => resolve("stuck"), this.#settleTimeoutMs);
      });
      const outcome = await Promise.race([Promise.allSettled([...this.#tracked]), stuck]);
      clearTimeout(guard);
      if (outcome === "stuck") {
        throw new Error(
          `FakeClock: tracked I/O did not settle within ${this.#settleTimeoutMs} ms of real time; ` +
            "track only real I/O, never a promise that waits on fake time",
        );
      }
    }
  }

  #earliest(until: number): Timer | undefined {
    return [...this.#timers.values()].filter((t) => t.dueAt <= until).sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
  }

  #schedule(ms: number, fire: () => void): number {
    const id = this.#nextId++;
    this.#timers.set(id, { id, dueAt: this.#now + Math.max(0, ms), fire });
    return id;
  }
}
