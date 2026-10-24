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
