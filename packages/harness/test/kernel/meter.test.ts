import { describe, expect, it } from "vitest";
import { addUsage, totalTokens, ZERO_USAGE } from "../../src/kernel/contracts.ts";
import { BudgetError } from "../../src/kernel/errors.ts";
import { TokenMeter } from "../../src/kernel/meter.ts";

const u = (inputTokens: number, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0) => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
});

describe("usage arithmetic", () => {
  it("adds field by field and totals all four", () => {
    expect(addUsage(u(1, 2, 3, 4), u(10, 20, 30, 40))).toEqual(u(11, 22, 33, 44));
    expect(totalTokens(u(1, 2, 3, 4))).toBe(10);
    expect(totalTokens(ZERO_USAGE)).toBe(0);
    expect(Object.isFrozen(ZERO_USAGE)).toBe(true);
  });
});

describe("TokenMeter", () => {
  it("accumulates usage and total", () => {
    const meter = new TokenMeter(1_000);
    meter.add(u(100, 50, 25, 25));
    meter.add(u(1));
    expect(meter.total).toBe(201);
    expect(meter.usage).toEqual(u(101, 50, 25, 25));
    expect(meter.cap).toBe(1_000);
  });

  it("add throws above the cap but records the usage", () => {
    const meter = new TokenMeter(1_000);
    meter.add(u(1_000));
    expect(() => meter.add(u(1))).toThrow(new BudgetError(1_001, 1_000));
    expect(meter.total).toBe(1_001);
  });

  it("assertCanSpend throws at the cap", () => {
    const meter = new TokenMeter(1_000);
    meter.add(u(999));
    expect(() => meter.assertCanSpend()).not.toThrow();
    meter.add(u(1));
    expect(() => meter.assertCanSpend()).toThrow(BudgetError);
    expect(() => meter.assertCanSpend()).toThrow("token budget exhausted: 1,000 of 1,000");
  });

  it("usage is a copy", () => {
    const meter = new TokenMeter(10);
    const snapshot = meter.usage;
    snapshot.inputTokens = 99;
    expect(meter.total).toBe(0);
  });
});
