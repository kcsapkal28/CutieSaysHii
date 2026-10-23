import { describe, expect, it } from "vitest";
import { Deadline } from "../../src/kernel/deadline.ts";
import { TimeoutError } from "../../src/kernel/errors.ts";
import { FakeClock } from "../helpers/clock.ts";

function setup(ms = 50, maxExtensionMs = 1_000) {
  const clock = new FakeClock();
  const deadline = new Deadline(ms, { stage: "content", maxExtensionMs, clock });
  return { clock, deadline };
}

describe("Deadline", () => {
  it("fires with TimeoutError", async () => {
    const { clock, deadline } = setup();
    await clock.advance(49);
    expect(deadline.fired).toBe(false);
    expect(deadline.signal.aborted).toBe(false);
    await clock.advance(1);
    expect(deadline.fired).toBe(true);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBeInstanceOf(TimeoutError);
    expect((deadline.signal.reason as TimeoutError).message).toBe("stage content exceeded 50 ms");
  });

  it("extend(60) at 40/50 fires at 110", async () => {
    const { clock, deadline } = setup();
    await clock.advance(40);
    expect(deadline.extend(60)).toBe(60);
    await clock.advance(69);
    expect(deadline.fired).toBe(false);
    await clock.advance(1);
    expect(clock.now()).toBe(110);
    expect(deadline.fired).toBe(true);
  });

  it("restart at 40 fires at 90", async () => {
    const { clock, deadline } = setup();
    await clock.advance(40);
    deadline.restart();
    await clock.advance(49);
    expect(deadline.fired).toBe(false);
    await clock.advance(1);
    expect(deadline.fired).toBe(true);
  });

  it("extension clamp", async () => {
    const { clock, deadline } = setup(50, 100);
    expect(deadline.extend(80)).toBe(80);
    expect(deadline.extend(80)).toBe(20);
    expect(deadline.extend(5)).toBe(0);
    deadline.restart();
    expect(deadline.extend(10)).toBe(0);
    await clock.advance(49);
    expect(deadline.fired).toBe(false);
    await clock.advance(1);
    expect(deadline.fired).toBe(true);
  });

  it("restart keeps the remaining extension budget and drops granted extensions from the due time", async () => {
    const { clock, deadline } = setup(50, 100);
    expect(deadline.extend(30)).toBe(30);
    await clock.advance(10);
    deadline.restart();
    expect(deadline.extend(100)).toBe(70);
    await clock.advance(119);
    expect(deadline.fired).toBe(false);
    await clock.advance(1);
    expect(deadline.fired).toBe(true);
  });

  it("ignores negative extensions and changes nothing once fired", async () => {
    const { clock, deadline } = setup(50, 100);
    expect(deadline.extend(-5)).toBe(0);
    await clock.advance(50);
    expect(deadline.fired).toBe(true);
    const reason = deadline.signal.reason;
    expect(deadline.extend(10)).toBe(0);
    deadline.restart();
    await clock.advance(100);
    expect(deadline.signal.reason).toBe(reason);
  });

  it("dispose", async () => {
    const { clock, deadline } = setup();
    await clock.advance(10);
    deadline.dispose();
    expect(deadline.extend(10)).toBe(0);
    deadline.restart();
    await clock.advance(1_000);
    expect(deadline.fired).toBe(false);
    expect(deadline.signal.aborted).toBe(false);
    expect(clock.pendingTimers()).toBe(0);
  });
});
