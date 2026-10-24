// Loads the engine (@deckforge/forge) at runtime, outside the bundler.
//
// Why: the engine resolves its shell sources and @fontsource packages from `import.meta.url` with
// createRequire().resolve(). Turbopack statically rewrites those calls and they fail. Importing it with
// turbopackIgnore makes Node load the TypeScript source directly; parameter properties in the engine need
// NODE_OPTIONS=--experimental-transform-types, which the package scripts set.
type Forge = typeof import("@deckforge/forge");

let mod: Promise<Forge> | undefined;

export function engine(): Promise<Forge> {
  mod ??= import(/* turbopackIgnore: true */ /* webpackIgnore: true */ "@deckforge/forge") as Promise<Forge>;
  return mod;
}
