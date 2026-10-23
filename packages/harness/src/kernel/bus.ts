import type { EventEnvelope } from "./events.ts";

/** A returned promise is observed only for rejection. */
export type EnvelopeListener = (envelope: EventEnvelope) => unknown;
export type ListenerErrorHandler = (error: unknown, envelope: EventEnvelope) => void;

const ALL = "*";

/** In-process fan-out of persisted events. A failing listener never affects the publisher or other listeners. */
export class EventBus {
  readonly #listeners = new Map<string, Set<EnvelopeListener>>();
  readonly #onListenerError: ListenerErrorHandler;

  constructor(options: { onListenerError?: ListenerErrorHandler } = {}) {
    this.#onListenerError = options.onListenerError ?? (() => {});
  }

  publish(envelope: EventEnvelope): void {
    const targets = [...(this.#listeners.get(envelope.event.jobId) ?? []), ...(this.#listeners.get(ALL) ?? [])];
    for (const fn of targets) {
      try {
        const result = fn(envelope);
        if (result instanceof Promise) result.catch((e: unknown) => this.#report(e, envelope));
      } catch (e) {
        this.#report(e, envelope);
      }
    }
  }

  /** `jobId` "*" receives every job's events. Returns an idempotent unsubscribe. */
  subscribe(jobId: string, fn: EnvelopeListener): () => void {
    const set = this.#listeners.get(jobId) ?? new Set<EnvelopeListener>();
    this.#listeners.set(jobId, set);
    const entry: EnvelopeListener = (e) => fn(e);
    set.add(entry);
    return () => {
      set.delete(entry);
      if (set.size === 0 && this.#listeners.get(jobId) === set) this.#listeners.delete(jobId);
    };
  }

  #report(error: unknown, envelope: EventEnvelope): void {
    try {
      this.#onListenerError(error, envelope);
    } catch {
      // The error handler itself must not break delivery.
    }
  }
}
