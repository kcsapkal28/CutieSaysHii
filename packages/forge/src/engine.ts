// The Engine port the agent pipeline uses (see contract.ts).
import { bundleDeck } from "./bundle.ts";
import type { Engine } from "./contract.ts";
import { shootDeck } from "./shoot.ts";

export function createEngine(): Engine {
  return {
    bundle: (input) => bundleDeck(input),
    shoot: (input) => shootDeck(input),
  };
}
