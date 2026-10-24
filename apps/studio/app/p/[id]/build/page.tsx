import { Suspense } from "react";
import { BuildView } from "@/components/build-view";

export default function BuildPage() {
  return (
    <Suspense>
      <BuildView />
    </Suspense>
  );
}
