import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Design boundaries (plan: Global Constraints, M3/M4). Relative imports are resolved to absolute
// paths; bare specifiers are compared by exact package name.
const HARNESS = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(HARNESS, "src");
const REPO = resolve(HARNESS, "../..");

const PURE_LAYERS = ["kernel", "wire", "fakes", "validate", "agents", "design", "patches", "qa", "stages", "pipeline"];
// Empty on purpose: the "." export must stay browser-safe (Plan 5).
const PURE_NODE_BUILTINS = new Set<string>();
const PURE_WORKSPACE_IMPORTS = new Set(["@deckforge/schemas", "@deckforge/catalog", "@deckforge/renderer/hash"]);
const PROCESS_ENV_FILES = new Set(["src/env.ts", "src/node.ts", "src/cli/main.ts"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".cache", "test-results", "playwright-report"]);
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

type Source = { abs: string; rel: string; text: string; imports: string[] };

function walk(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(join(dir, e.name));
    return e.isFile() && SOURCE_FILE.test(e.name) ? [join(dir, e.name)] : [];
  });
}

function importsOf(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
}

function load(abs: string, base: string): Source {
  const text = readFileSync(abs, "utf8");
  return { abs, rel: relative(base, abs).split(sep).join("/"), text, imports: importsOf(text) };
}

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function topLevelMutables(text: string): string[] {
  return parse(text)
    .statements.filter(ts.isVariableStatement)
    .filter((s) => (s.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Using)) === 0)
    .flatMap((s) => s.declarationList.declarations.map((d) => d.name.getText()));
}

const PROCESS_MODULES = new Set(["process", "node:process"]);

function processEnvUses(text: string): number {
  const file = parse(text);
  const aliases = new Set(["process"]);
  let count = 0;
  for (const st of file.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!PROCESS_MODULES.has(st.moduleSpecifier.text) || !st.importClause) continue;
    const { name, namedBindings } = st.importClause;
    if (name) aliases.add(name.text);
    if (namedBindings && ts.isNamespaceImport(namedBindings)) aliases.add(namedBindings.name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      count += namedBindings.elements.filter((el) => (el.propertyName ?? el.name).text === "env").length;
    }
  }
  const isProcess = (e: ts.Expression) => ts.isIdentifier(e) && aliases.has(e.text);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isProcess(node.expression) && node.name.text === "env") count += 1;
    if (
      ts.isElementAccessExpression(node) &&
      isProcess(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "env"
    ) {
      count += 1;
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isProcess(node.initializer)) {
      count += node.name.elements.filter((el) => (el.propertyName ?? el.name).getText() === "env").length;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

// Uses of createLlmClient: calls, directly, through an import alias or as a module member, and any other
// value use (passing it around would hide the call site). Import/export specifiers, its own declaration
// and unrelated property names don't count.
function createLlmClientUses(text: string): number {
  const file = parse(text);
  const names = new Set(["createLlmClient"]);
  for (const st of file.statements) {
    const bindings = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) if ((el.propertyName ?? el.name).text === "createLlmClient") names.add(el.name.text);
  }
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === "createLlmClient") {
      if (node.body) visit(node.body);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === "createLlmClient") count += 1;
      visit(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      visit(node.initializer);
      return;
    }
    if (ts.isIdentifier(node) && names.has(node.text)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

const isPkg = (spec: string, name: string) => spec === name || spec.startsWith(`${name}/`);
const isRelative = (spec: string) => spec.startsWith("./") || spec.startsWith("../");
const inPureLayer = (abs: string) => PURE_LAYERS.some((layer) => abs.startsWith(join(SRC, layer) + sep));
const isNodeEntry = (spec: string) => !isRelative(spec) && spec.split("/").at(-1) === "node";

const harnessSrc = walk(SRC).map((abs) => load(abs, HARNESS));
const pure = harnessSrc.filter((s) => inPureLayer(s.abs));
const allPackages = ["packages", "apps", "scripts"].flatMap((d) => walk(join(REPO, d))).map((abs) => load(abs, REPO));
const isTestFile = (rel: string) => /(^|\/)test\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);

function pureImportViolation(source: Source, spec: string): string | null {
  if (spec.startsWith("node:") || isBuiltin(spec)) {
    const normalized = spec.startsWith("node:") ? spec : `node:${spec}`;
    return PURE_NODE_BUILTINS.has(normalized) ? null : `${spec} (node builtin; pure layers stay browser-safe)`;
  }
  if (isRelative(spec)) {
    const target = resolve(dirname(source.abs), spec);
    return inPureLayer(target) ? null : `${spec} (resolves outside the pure layers to ${relative(HARNESS, target)})`;
  }
  if (isNodeEntry(spec)) return `${spec} (*/node entry)`;
  if (isPkg(spec, "@anthropic-ai/sdk") || isPkg(spec, "drizzle-orm")) return `${spec} (adapter dependency)`;
  return null;
}

function workspaceImportViolation(spec: string): string | null {
  return isPkg(spec, "@deckforge") && !PURE_WORKSPACE_IMPORTS.has(spec) ? spec : null;
}

describe("architecture", () => {
  it("scans the harness sources and the pure layers", () => {
    expect(pure.map((s) => s.rel)).toContain("src/kernel/contracts.ts");
    expect(pure.map((s) => s.rel)).toContain("src/wire/schema.ts");
    expect(allPackages.length).toBeGreaterThan(harnessSrc.length);
  });

  it("only src/llm.ts imports @anthropic-ai/sdk (all packages)", () => {
    const offenders = allPackages
      .filter((s) => s.imports.some((spec) => isPkg(spec, "@anthropic-ai/sdk")))
      .map((s) => s.rel)
      .filter((rel) => rel !== "packages/harness/src/llm.ts");
    expect(offenders).toEqual([]);
  });

  it("only src/node.ts calls createLlmClient (all packages, tests excepted)", () => {
    const offenders = allPackages
      .filter((s) => !isTestFile(s.rel) && createLlmClientUses(s.text) > 0)
      .map((s) => s.rel)
      .filter((rel) => rel !== "packages/harness/src/node.ts");
    expect(offenders).toEqual([]);
  });

  it("only src/adapters/sqlite/** imports drizzle-orm or node:sqlite", () => {
    const offenders = harnessSrc
      .filter((s) => s.imports.some((spec) => isPkg(spec, "drizzle-orm") || spec === "node:sqlite"))
      .map((s) => s.rel)
      .filter((rel) => !rel.startsWith("src/adapters/sqlite/"));
    expect(offenders).toEqual([]);
  });

  it("only src/adapters/** touches the filesystem or the renderer (except its pure hash entry)", () => {
    const touches = (spec: string) =>
      ["fs", "node:fs", "fs/promises", "node:fs/promises"].includes(spec) || (isPkg(spec, "@deckforge/renderer") && spec !== "@deckforge/renderer/hash");
    const offenders = harnessSrc
      .filter((s) => !s.rel.startsWith("src/adapters/"))
      .flatMap((s) => s.imports.filter(touches).map((spec) => `${s.rel}: ${spec}`));
    expect(offenders).toEqual([]);
  });

  it("pure layers import no I/O, node:crypto, adapters, llm.ts, env.ts or */node entries", () => {
    const offenders = pure.flatMap((s) =>
      s.imports.flatMap((spec) => {
        const why = pureImportViolation(s, spec);
        return why ? [`${s.rel}: ${why}`] : [];
      }),
    );
    expect(offenders).toEqual([]);
  });

  it("pure layers import only @deckforge/schemas, @deckforge/catalog and exactly @deckforge/renderer/hash", () => {
    const offenders = pure.flatMap((s) =>
      s.imports.filter((spec) => workspaceImportViolation(spec) !== null).map((spec) => `${s.rel}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("process.env only in env.ts, node.ts, cli/main.ts", () => {
    const offenders = harnessSrc.filter((s) => !PROCESS_ENV_FILES.has(s.rel) && processEnvUses(s.text) > 0).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it("no top-level let/var", () => {
    const offenders = pure.flatMap((s) => topLevelMutables(s.text).map((name) => `${s.rel}: ${name}`));
    expect(offenders).toEqual([]);
  });

  it('"localhost:4001" only in src/env.ts', () => {
    const offenders = harnessSrc.filter((s) => s.rel !== "src/env.ts" && s.text.includes("localhost:4001")).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});

describe("architecture detectors", () => {
  it("find static, re-export, type-only, dynamic and require imports, but not comments", () => {
    const text = [
      'import a from "a";',
      'export * from "b";',
      'import type { T } from "c";',
      'const d = await import("d");',
      'const e = require("e");',
      '// import f from "f";',
    ].join("\n");
    expect(importsOf(text)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("flag top-level let/var but not const or nested let", () => {
    expect(topLevelMutables("let a = 1; var b = 2; const c = 3; function f() { let d = 4; return d; }")).toEqual(["a", "b"]);
  });

  it("count process.env reads in every spelling", () => {
    expect(processEnvUses('const a = process.env.X; const b = process["env"]; const { env } = process; const p = processes.env;')).toBe(3);
    expect(processEnvUses('import { env } from "node:process"; export const k = env.K;')).toBe(1);
    expect(processEnvUses('import { env as e } from "process";')).toBe(1);
    expect(processEnvUses('import proc from "node:process"; const k = proc.env.K;')).toBe(1);
    expect(processEnvUses('import * as p from "node:process"; const k = p["env"];')).toBe(1);
    expect(processEnvUses('import { argv } from "node:process"; const env = {}; const k = env;')).toBe(0);
  });

  it("find createLlmClient calls and value uses, but not imports, exports or its declaration", () => {
    expect(createLlmClientUses('import { createLlmClient } from "./llm.ts"; const c = createLlmClient(env.llm);')).toBe(1);
    expect(createLlmClientUses('import { createLlmClient as make } from "./llm.ts"; const c = make(env.llm);')).toBe(1);
    expect(createLlmClientUses('import * as llm from "./llm.ts"; const c = llm.createLlmClient(env.llm);')).toBe(1);
    expect(createLlmClientUses("const f = createLlmClient; f(x);")).toBe(1);
    expect(createLlmClientUses("const c = await (await import('./llm.ts')).createLlmClient(x);")).toBe(1);
    expect(createLlmClientUses('export { createLlmClient } from "./llm.ts"; export * from "./env.ts";')).toBe(0);
    expect(createLlmClientUses("export function createLlmClient(llm) { return new Anthropic(llm); }")).toBe(0);
    expect(createLlmClientUses('// createLlmClient(x)\nconst s = "createLlmClient(x)";')).toBe(0);
    expect(createLlmClientUses("const o = { createLlmClient: 1 }; const n = o.other;")).toBe(0);
    expect(createLlmClientUses("const o = { createLlmClient };")).toBe(1);
  });

  it("tell test files from sources", () => {
    expect(isTestFile("packages/harness/test/llm/anthropic.test.ts")).toBe(true);
    expect(isTestFile("packages/harness/test/cli/fake-entry.ts")).toBe(true);
    expect(isTestFile("packages/web/src/x.spec.tsx")).toBe(true);
    expect(isTestFile("packages/harness/src/node.ts")).toBe(false);
    expect(isTestFile("scripts/record-golden.ts")).toBe(false);
  });

  it("allow exactly the whitelisted @deckforge imports", () => {
    for (const ok of ["@deckforge/schemas", "@deckforge/catalog", "@deckforge/renderer/hash", "zod"]) {
      expect(workspaceImportViolation(ok)).toBeNull();
    }
    for (const bad of [
      "@deckforge/renderer",
      "@deckforge/renderer/node",
      "@deckforge/renderer/hash/x",
      "@deckforge/catalog/node",
      "@deckforge/schemas/src/deck.ts",
      "@deckforge/harness",
    ]) {
      expect(workspaceImportViolation(bad)).toBe(bad);
    }
  });

  it("classify pure-layer imports", () => {
    const kernelFile: Source = { abs: join(SRC, "kernel", "x.ts"), rel: "src/kernel/x.ts", text: "", imports: [] };
    const why = (spec: string) => pureImportViolation(kernelFile, spec);
    expect(why("./contracts.ts")).toBeNull();
    expect(why("../wire/schema.ts")).toBeNull();
    expect(why("zod")).toBeNull();
    for (const builtin of ["node:path", "path", "node:events", "node:util", "node:crypto", "fs", "node:fs/promises", "node:child_process"]) {
      expect(why(builtin)).toMatch(/node builtin/);
    }
    expect(why("../adapters/fs-artifacts.ts")).toMatch(/outside the pure layers/);
    expect(why("../llm.ts")).toMatch(/src\/llm\.ts/);
    expect(why("../env.ts")).toMatch(/outside/);
    expect(why("../kernel-evil/x.ts")).toMatch(/outside/);
    expect(why("@deckforge/catalog/node")).toMatch(/node entry/);
    expect(why("@anthropic-ai/sdk")).toMatch(/adapter/);
  });
});
