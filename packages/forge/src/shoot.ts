// Opens a bundled deck in headless Chromium (WebGL via SwiftShader) and screenshots every step of each slide.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { CANVAS, type Finding, type ShootResult, type Shot } from "./contract.ts";
import { measureStep, slideFindings, type StepMeasure } from "./measure.ts";

const READY_TIMEOUT_MS = 30_000;
const MAX_STEPS = 24;
const LOCAL = /^(file|data|about|blob):/i;

export const CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];

/** Slide ids in deck order, read from the deck's embedded `df-config`. */
export function deckSlideIds(deckFile: string): string[] {
  const html = readFileSync(deckFile, "utf8");
  const m = /<script type="application\/json" id="df-config">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error(`${deckFile} is not a DeckForge deck (no df-config)`);
  const cfg = JSON.parse(m[1]!) as { slides: { id: string }[] };
  return cfg.slides.map((s) => s.id);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms);
    p.then(
      (v) => (clearTimeout(t), res(v)),
      (e: unknown) => (clearTimeout(t), rej(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

async function shootSlide(
  page: Page,
  url: string,
  id: string,
  push: (key: string, msg: string) => void,
  measure: boolean,
): Promise<{ shots: Shot[]; steps: number; findings: Finding[] }> {
  const shots: Shot[] = [];
  const measured: StepMeasure[] = [];
  const alive = new Set<string>();
  await page.goto(`${url}?df-shot=${encodeURIComponent(id)}&step=0`, { waitUntil: "load" });
  const ok = await withTimeout(
    page.evaluate(() => (window.__dfReady ? window.__dfReady.then(() => true) : false)),
    READY_TIMEOUT_MS,
    `${id} to become ready (window.__dfReady)`,
  );
  if (!ok) {
    push("deck", "the shell did not load (window.__dfReady is missing)");
    return { shots, steps: 0, findings: [] };
  }
  const steps = Math.min(MAX_STEPS, (await page.evaluate(() => window.__dfSteps ?? 1)) || 1);
  for (let step = 0; step < steps; step++) {
    if (step > 0) {
      await withTimeout(
        page.evaluate((n) => window.__dfGoto!(n), step),
        READY_TIMEOUT_MS,
        `${id} step ${step}`,
      );
    }
    const png = await page.screenshot({ type: "png" });
    shots.push({ slideId: id, step, png });
    // The pre-check is advisory plumbing: if measuring itself fails, the slide is judged without it.
    if (measure) measured.push(await measureStep(page, id, step, png, alive).catch(() => ({ step, findings: [], canvases: [] })));
  }
  return { shots, steps, findings: measure ? slideFindings(id, measured, shots.map((s) => s.png)) : [] };
}

/** Engine.shoot. Pass `browser` to reuse one Chromium across calls; `measure: false` skips the pre-check (measure.ts). */
export async function shootDeck(input: { deckFile: string; slideIds?: string[]; browser?: Browser; measure?: boolean }): Promise<ShootResult> {
  const deckFile = resolve(input.deckFile);
  const all = deckSlideIds(deckFile);
  const ids = input.slideIds?.length ? input.slideIds : all;
  const result: ShootResult = { shots: [], steps: {}, errors: {}, externalRequests: [], findings: {} };
  const findings = result.findings!;
  const push = (key: string, msg: string) => (result.errors[key] ??= []).push(msg);
  for (const id of ids) {
    result.errors[id] = [];
    if (!all.includes(id)) push(id, `slide "${id}" is not in this deck (${all.join(", ")})`);
  }

  const browser = input.browser ?? (await chromium.launch({ args: CHROMIUM_ARGS }));
  try {
    const context = await browser.newContext({ viewport: { ...CANVAS }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (LOCAL.test(url)) return route.continue();
      result.externalRequests.push(url);
      return route.abort("blockedbyclient");
    });
    const url = pathToFileURL(deckFile).href;
    for (const id of ids.filter((i) => all.includes(i))) {
      const page = await context.newPage();
      const key = (msg: string) => (/^\[df:deck\]/.test(msg) ? "deck" : id);
      page.on("console", (msg) => {
        if (msg.type() === "error") push(key(msg.text()), msg.text());
      });
      page.on("pageerror", (err) => push(id, `${err.name}: ${err.message}`));
      page.on("requestfailed", (req) => {
        if (LOCAL.test(req.url())) push(id, `request failed: ${req.url()} (${req.failure()?.errorText ?? "?"})`);
      });
      try {
        const r = await shootSlide(page, url, id, push, input.measure ?? true);
        result.shots.push(...r.shots);
        result.steps[id] = r.steps;
        findings[id] = r.findings;
      } catch (e) {
        push(id, `shoot failed: ${(e as Error).message}`);
      } finally {
        await page.close();
      }
    }
    await context.close();
  } finally {
    if (!input.browser) await browser.close();
  }
  for (const k of Object.keys(result.errors)) if (k === "deck" && result.errors[k]!.length === 0) delete result.errors[k];
  return result;
}
