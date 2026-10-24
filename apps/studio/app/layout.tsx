import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fontFaceLinksCss } from "@/lib/server/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DeckForge Studio", template: "%s · DeckForge Studio" },
  description: "Turn a topic into a self-contained explainer deck.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const fonts = await fontFaceLinksCss();
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/inter-tight/400" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/inter-tight/500" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/fraunces/400" as="font" type="font/woff2" crossOrigin="" />
        <style id="studio-fonts" dangerouslySetInnerHTML={{ __html: fonts }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
