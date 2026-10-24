import { previewHtml } from "@/lib/server/preview";

export const dynamic = "force-dynamic";

/** GET /preview/sample?features=timer,notes → the Style Studio's sample deck. */
export async function GET(req: Request) {
  const on = new Set((new URL(req.url).searchParams.get("features") ?? "").split(",").filter(Boolean));
  try {
    const html = await previewHtml({ timer: on.has("timer"), notes: on.has("notes"), stepNav: on.has("stepNav"), print: on.has("print") });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return new Response(`Preview failed to build: ${(e as Error).message}`, { status: 500 });
  }
}
