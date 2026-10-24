import { StyleStudio } from "@/components/style-studio";
import { backend } from "@/lib/server/backend-instance";
import { fontOptions } from "@/lib/server/fonts";
import type { Style } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, fonts] = await Promise.all([backend().loadProject(id), fontOptions()]);
  const raw = p?.files["style.json"];
  const initial = raw ? (JSON.parse(raw) as Style) : null;
  return <StyleStudio fonts={fonts} initial={initial} />;
}
