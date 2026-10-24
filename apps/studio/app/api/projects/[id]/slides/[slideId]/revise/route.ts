import { backend } from "@/lib/server/backend-instance";
import { errorResponse, sse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST { instruction } → SSE stream of the revise run (detached, like stage runs). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; slideId: string }> }) {
  try {
    const { id, slideId } = await ctx.params;
    const { instruction } = (await req.json()) as { instruction?: string };
    if (!instruction?.trim()) return Response.json({ error: "Describe the change first." }, { status: 422 });
    if (!/^s\d{2,3}$/.test(slideId)) return Response.json({ error: `Unknown slide "${slideId}"` }, { status: 404 });
    return sse((signal) => backend().reviseSlide(id, slideId, instruction.trim(), { signal }), req.signal);
  } catch (e) {
    return errorResponse(e);
  }
}
