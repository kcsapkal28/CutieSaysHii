// Helpers shared by the route handlers.
import type { PipelineEvent } from "../events";
import { NotFound } from "../backend";
import { STAGES, type StageName } from "../types";

export function errorResponse(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof NotFound ? 404 : e instanceof SyntaxError ? 400 : (e as { name?: string })?.name === "ZodError" ? 422 : 400;
  return Response.json({ error: message }, { status });
}

export function isStage(s: string): s is StageName {
  return (STAGES as readonly string[]).includes(s);
}

/** Streams an event iterable as server-sent events. Aborts the run when the client goes away. */
export function sse(run: (signal: AbortSignal) => AsyncIterable<PipelineEvent>, requestSignal: AbortSignal): Response {
  const ctrl = new AbortController();
  requestSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 15_000);
      try {
        for await (const ev of run(ctrl.signal)) {
          controller.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          const ev: PipelineEvent = { type: "error", message: (e as Error).message, retryable: true };
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify(ev)}\n\n`));
        }
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      ctrl.abort();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
