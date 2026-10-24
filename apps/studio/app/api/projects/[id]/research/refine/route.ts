import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";
import type { ResearchRefineRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Partial<ResearchRefineRequest> | null;
    if (typeof body?.markdown !== "string" || typeof body.start !== "number" || typeof body.end !== "number" || typeof body.question !== "string")
      return Response.json({ error: "Send the document, the selected range and a question." }, { status: 422 });
    const { markdown, start, end, question } = body;
    return Response.json(await backend().refineResearch(id, { markdown, start, end, question }));
  } catch (e) {
    return errorResponse(e);
  }
}
