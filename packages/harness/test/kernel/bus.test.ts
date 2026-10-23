import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/kernel/bus.ts";
import type { EventEnvelope } from "../../src/kernel/events.ts";

const env = (seq: number, jobId: string): EventEnvelope => ({ seq, event: { type: "job:queued", jobId, at: seq } });

describe("EventBus", () => {
  it("delivers to the job's subscribers and to wildcard subscribers, in order", () => {
    const bus = new EventBus();
    const a: number[] = [];
    const all: string[] = [];
    bus.subscribe("a", (e) => a.push(e.seq));
    bus.subscribe("*", (e) => all.push(`${e.event.jobId}:${e.seq}`));
    bus.publish(env(1, "a"));
    bus.publish(env(2, "b"));
    bus.publish(env(3, "a"));
    expect(a).toEqual([1, 3]);
    expect(all).toEqual(["a:1", "b:2", "a:3"]);
  });

  it("unsubscribe stops delivery, including from inside a listener", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const off = bus.subscribe("a", (e) => {
      seen.push(e.seq);
      off();
    });
    const other: number[] = [];
    const offOther = bus.subscribe("a", (e) => other.push(e.seq));
    bus.publish(env(1, "a"));
    bus.publish(env(2, "a"));
    offOther();
    offOther();
    bus.publish(env(3, "a"));
    expect(seen).toEqual([1]);
    expect(other).toEqual([1, 2]);
  });

  it("isolates listener errors, sync and async, and reports them", async () => {
    const onListenerError = vi.fn();
    const bus = new EventBus({ onListenerError });
    const seen: number[] = [];
    bus.subscribe("a", () => {
      throw new Error("sync boom");
    });
    bus.subscribe("a", async () => {
      throw new Error("async boom");
    });
    bus.subscribe("a", (e) => seen.push(e.seq));
    expect(() => bus.publish(env(1, "a"))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([1]);
    expect(onListenerError).toHaveBeenCalledTimes(2);
    expect(onListenerError.mock.calls.map(([err]) => (err as Error).message).sort()).toEqual(["async boom", "sync boom"]);
    expect(onListenerError.mock.calls[0]?.[1]).toEqual(env(1, "a"));
  });

  it("swallows listener errors silently when no handler is given", () => {
    const bus = new EventBus();
    bus.subscribe("*", () => {
      throw new Error("ignored");
    });
    expect(() => bus.publish(env(1, "a"))).not.toThrow();
  });
});
