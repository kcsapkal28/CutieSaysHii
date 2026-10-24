import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  try {
    const { id, version } = await ctx.params;
    const v = Number(version);
    if (!Number.isInteger(v) || v < 1) return Response.json({ error: `Unknown version "${version}"` }, { status: 404 });
    return Response.json(await backend().restoreVersion(id, v));
  } catch (e) {
    return errorResponse(e);
  }
}
