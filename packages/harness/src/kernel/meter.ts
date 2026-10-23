import { addUsage, totalTokens, ZERO_USAGE, type TokenUsage } from "./contracts.ts";
import { BudgetError } from "./errors.ts";

/** Caps the tokens one job invocation may spend (input + output + cache read + cache write). */
export class TokenMeter {
  readonly cap: number;
  #usage: TokenUsage = { ...ZERO_USAGE };

  constructor(cap: number) {
    this.cap = cap;
  }

  get usage(): TokenUsage {
    return { ...this.#usage };
  }

  get total(): number {
    return totalTokens(this.#usage);
  }

  /** Records the usage, then throws if the total is now above the cap. */
  add(usage: TokenUsage): void {
    this.#usage = addUsage(this.#usage, usage);
    if (this.total > this.cap) throw new BudgetError(this.total, this.cap);
  }

  /** The before-call check: throws once the cap is reached. */
  assertCanSpend(): void {
    if (this.total >= this.cap) throw new BudgetError(this.total, this.cap);
  }
}
