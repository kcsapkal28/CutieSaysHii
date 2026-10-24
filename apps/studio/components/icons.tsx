// 16px stroke icons, drawn to one grid. currentColor throughout.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
);
export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5M3.6 3.6l1.6 1.6M10.8 10.8l1.6 1.6M3.6 12.4l1.6-1.6M10.8 5.2l1.6-1.6" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const IconArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </Svg>
);
export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);
export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M13.25 8A5.25 5.25 0 1 1 11.7 4.3M13.25 2.5v3h-3" />
  </Svg>
);
export const IconEdit = (p: P) => (
  <Svg {...p}>
    <path d="M10.5 2.75l2.75 2.75L6 12.75H3.25V10z" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5v8M4.5 7.25L8 10.75l3.5-3.5M2.75 13.25h10.5" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const IconHistory = (p: P) => (
  <Svg {...p}>
    <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.8M2.5 2.75v2.5H5M8 5v3.25l2 1.25" />
  </Svg>
);
export const IconChat = (p: P) => (
  <Svg {...p}>
    <path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5v-2.5h0a1.5 1.5 0 0 1-1.25-1.5z" />
  </Svg>
);
export const IconCompare = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="3" width="5" height="10" rx="1" />
    <rect x="9" y="3" width="5" height="10" rx="1" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);
export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 4L2.75 6.75 5.5 9.5M3 6.75h6.25a3.75 3.75 0 0 1 0 7.5H7" />
  </Svg>
);
export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M9 2.75h4.25V7M13 3L7.5 8.5M11.5 9.5v3.25a.5.5 0 0 1-.5.5H3.25a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5H6.5" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M8 5v3.5M8 11h.01" />
    <circle cx="8" cy="8" r="6" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />
  </Svg>
);
export const IconUp = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 9.5L8 6l3.5 3.5" />
  </Svg>
);
