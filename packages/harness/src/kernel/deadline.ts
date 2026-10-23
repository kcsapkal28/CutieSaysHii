import type { StageName } from "./contracts.ts";
import { TimeoutError } from "./errors.ts";
import type { Clock } from "./ports.ts";

export type DeadlineOptions = {
  stage: StageName;
  /** Total time `extend` may add over the deadline's life (rate-limit backoff). */
  maxExtensionMs: number;
  clock: Clock;
};

/**
 * Aborts `signal` with a `TimeoutError(stage, ms)` once `ms` elapses. `extend` postpones the
 * deadline within the extension budget; `restart` grants the full `ms` again from now and keeps
 * whatever extension budget is left.
 */
export class Deadline {
  readonly #controller = new AbortController();
  readonly #ms: number;
  readonly #stage: StageName;
  readonly #clock: Clock;
  #dueAt: number;
  #extensionLeft: number;
  #timer: AbortController | undefined;
  #disposed = false;

  constructor(ms: number, options: DeadlineOptions) {
    this.#ms = ms;
    this.#stage = options.stage;
    this.#clock = options.clock;
    this.#extensionLeft = Math.max(0, options.maxExtensionMs);
    this.#dueAt = this.#clock.now() + ms;
    this.#arm();
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get fired(): boolean {
    return this.#controller.signal.aborted;
  }

  /** Returns the milliseconds actually granted (0 once fired, disposed or out of budget). */
  extend(ms: number): number {
    if (!this.#active()) return 0;
    const granted = Math.min(Math.max(0, ms), this.#extensionLeft);
    if (granted === 0) return 0;
    this.#extensionLeft -= granted;
    this.#dueAt += granted;
    this.#arm();
    return granted;
  }

  restart(): void {
    if (!this.#active()) return;
    this.#dueAt = this.#clock.now() + this.#ms;
    this.#arm();
  }

  dispose(): void {
    this.#disposed = true;
    this.#timer?.abort();
    this.#timer = undefined;
  }

  #active(): boolean {
    return !this.#disposed && !this.fired;
  }

  #arm(): void {
    this.#timer?.abort();
    const timer = new AbortController();
    this.#timer = timer;
    const wait = Math.max(0, this.#dueAt - this.#clock.now());
    this.#clock.sleep(wait, timer.signal).then(
      () => {
        if (this.#timer !== timer || !this.#active()) return;
        this.#timer = undefined;
        this.#controller.abort(new TimeoutError(this.#stage, this.#ms));
      },
      () => {},
    );
  }
}
