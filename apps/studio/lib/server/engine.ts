// Loads the engine (@deckforge/forge) and its agent pipeline (@deckforge/forge/pipeline) at runtime, outside the bundler.
//
// Why: the engine resolves its shell sources and @fontsource packages from `import.meta.url` with
// createRequire().resolve(). Turbopack statically rewrites those calls and they fail. Importing it with
// turbopackIgnore makes Node load the TypeScript source directly (Node's built-in type stripping; the engine
// uses only erasable syntax, so no flags are needed).
type Forge = typeof import("@deckforge/forge");
type Pipeline = typeof import("@deckforge/forge/pipeline");

let mod: Promise<Forge> | undefined;
let pipe: Promise<Pipeline> | undefined;

export function engine(): Promise<Forge> {
  mod ??= import(/* turbopackIgnore: true */ /* webpackIgnore: true */ "@deckforge/forge") as Promise<Forge>;
  return mod;
}

export function pipeline(): Promise<Pipeline> {
  pipe ??= import(/* turbopackIgnore: true */ /* webpackIgnore: true */ "@deckforge/forge/pipeline") as Promise<Pipeline>;
  return pipe;
}

/**
 * The models the Studio runs every agent on. STUDIO_MODELS=opus (the default) puts every agent on Opus for the best
 * output; STUDIO_MODELS=default keeps the engine's cost-tuned defaults (Sonnet for most agents).
 */
export async function studioModels(): Promise<Partial<Record<import("@deckforge/forge/pipeline").AgentName, string>>> {
  const f = await pipeline();
  if ((process.env.STUDIO_MODELS ?? "opus") === "default") return {};
  return Object.fromEntries(Object.keys(f.DEFAULT_MODELS).map((agent) => [agent, f.MODELS.opus]));
}
