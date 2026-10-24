import { backend } from "@/lib/server/backend-instance";
import { errorResponse } from "@/lib/server/http";
import type { Brief } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await backend().listProjects());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Brief;
    if (!b?.topic || b.topic.trim().length < 3) return Response.json({ error: "Say what the talk is about (at least 3 characters)." }, { status: 422 });
    const minutes = Number(b.minutes);
    if (!(minutes > 0 && minutes <= 120)) return Response.json({ error: "Talk length must be between 1 and 120 minutes." }, { status: 422 });
    return Response.json(await backend().createProject({ ...b, topic: b.topic.trim(), audience: b.audience ?? "", goal: b.goal ?? "", minutes }), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
