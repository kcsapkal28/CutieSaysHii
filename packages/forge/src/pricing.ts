// Token prices, shared by the journal summary, `forge eval` and the Studio's cost readout.
import type { Usage } from "./llm.ts";

/** USD per million tokens [input, output]; cache reads at 10% of input, writes at 125%. Unknown models cost 0. */
export const PRICE: [RegExp, number, number][] = [
  [/opus/i, 15, 75],
  [/sonnet/i, 3, 15],
  [/haiku/i, 1, 5],
];

/** The USD cost of one call's (or a sum of calls') usage on `model`. */
export function costUsd(model: string, u: Usage): number {
  const p = PRICE.find(([re]) => re.test(model));
  if (!p) return 0;
  return (u.input * p[1] + u.cacheRead * p[1] * 0.1 + u.cacheWrite * p[1] * 1.25 + u.output * p[2]) / 1e6;
}
