import type { DeckRef } from "@/lib/backend";
import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET → the self-contained deck.html of a version ("latest", "draft" or a number). ?download=1 saves it. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  try {
    const { id, version } = await ctx.params;
    const ref: DeckRef = version === "latest" || version === "draft" ? version : Number(version);
    if (typeof ref === "number" && !(Number.isInteger(ref) && ref > 0)) return new Response("Not found", { status: 404 });
    const html = await backend().getDeckHtml(id, ref);
    if (html === null) return new Response("No deck yet", { status: 404 });
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
    if (new URL(req.url).searchParams.get("download")) headers["content-disposition"] = `attachment; filename="${id}-v${version}.html"`;
    return new Response(html, { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
