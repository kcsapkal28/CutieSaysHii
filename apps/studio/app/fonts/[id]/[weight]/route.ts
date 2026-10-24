import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { engine } from "@/lib/server/engine";

/** GET /fonts/<fontsource id>/<weight> → latin woff2 (for the studio UI and the style preview). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; weight: string }> }) {
  const { id, weight } = await ctx.params;
  const { fontMeta, isFontId } = await engine();
  if (!isFontId(id) || !/^\d00$/.test(weight)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(join(fontMeta(id).dir, "files", `${id}-latin-${weight}-normal.woff2`));
    return new Response(new Uint8Array(data), { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
