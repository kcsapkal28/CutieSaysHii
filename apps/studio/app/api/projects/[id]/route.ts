import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const p = await backend().loadProject(id);
    return p ? Response.json(p) : Response.json({ error: `No project "${id}"` }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}
