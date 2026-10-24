"use client";
import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/**
 * A deck page at its native 1920×1080, scaled to the container's width. Used for thumbnails, the build stage
 * and compare. `src` is usually a `?df-shot=<id>` URL (shot mode renders 1:1 with no chrome).
 */
export function SlideFrame({
  src,
  title,
  className,
  interactive = false,
  lazy = true,
  height = 1080,
}: {
  src: string;
  title: string;
  className?: string;
  interactive?: boolean;
  lazy?: boolean;
  /** Page height in deck pixels: 1080, or 1152 when the deck has a presenter dock. */
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [shownSrc, setShownSrc] = useState(src);
  if (shownSrc !== src) {
    setShownSrc(src);
    setLoaded(false);
  }

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale((e?.contentRect.width ?? 0) / 1920));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className={cx("relative w-full overflow-hidden bg-[#0b0c10]", className)} style={{ aspectRatio: `1920 / ${height}` }}>
      {scale > 0 && (
        <iframe
          key={src}
          src={src}
          title={title}
          loading={lazy ? "lazy" : "eager"}
          tabIndex={interactive ? 0 : -1}
          onLoad={() => setLoaded(true)}
          className={cx("absolute left-0 top-0 origin-top-left border-0 transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0", !interactive && "pointer-events-none")}
          style={{ width: 1920, height, transform: `scale(${scale})` }}
        />
      )}
      {!loaded && <div className="skeleton absolute inset-0" aria-hidden />}
    </div>
  );
}
