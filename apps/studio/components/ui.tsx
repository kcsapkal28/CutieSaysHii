"use client";
import Link from "next/link";
import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { StageStatus } from "@/lib/types";
import { IconAlert, IconCheck } from "./icons";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "ember" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-fg text-bg hover:bg-white disabled:bg-fg/40",
  secondary: "bg-raised text-fg border border-line hover:border-line-strong hover:bg-hover disabled:text-dim",
  ghost: "text-sub hover:text-fg hover:bg-hover disabled:text-dim",
  ember: "bg-ember text-[#1a1008] hover:bg-[#ffb47c] disabled:bg-ember/40",
  danger: "text-bad hover:bg-bad/10",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,color,border-color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed",
        size === "sm" && "h-7 px-2.5 text-[12.5px]",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-4 text-[14px]",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = "secondary", className, children, ...rest }: { href: string; variant?: Variant; className?: string; children: ReactNode; download?: boolean | string; prefetch?: boolean }) {
  const cls = cx(
    "inline-flex h-8 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors duration-150",
    VARIANT[variant],
    className,
  );
  if (rest.download !== undefined)
    return (
      <a href={href} download={rest.download} className={cls}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls} prefetch={rest.prefetch}>
      {children}
    </Link>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong/80 bg-bg/50 px-1 font-sans text-[11px] font-medium text-sub", className)}>
      {children}
    </kbd>
  );
}

export function Spinner({ className, size = 14 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cx("animate-spin", className)} aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const STATUS_LABEL: Record<StageStatus, string> = {
  idle: "Not started",
  running: "Running",
  review: "Ready for review",
  approved: "Approved",
  error: "Failed",
};

export function StatusGlyph({ status, size = 16 }: { status: StageStatus | "done" | "locked"; size?: number }) {
  const s = { width: size, height: size };
  if (status === "approved" || status === "done")
    return (
      <span style={s} className="grid shrink-0 place-items-center rounded-full bg-ok/15 text-ok">
        <IconCheck size={size - 5} strokeWidth={2} />
      </span>
    );
  if (status === "running") return <Spinner size={size} className="shrink-0 text-ember" />;
  if (status === "review")
    return (
      <span style={s} className="grid shrink-0 place-items-center">
        <span className="size-2 rounded-full bg-review shadow-[0_0_0_3px_rgb(170_179_255/0.18)]" />
      </span>
    );
  if (status === "error")
    return (
      <span style={s} className="grid shrink-0 place-items-center text-bad">
        <IconAlert size={size} />
      </span>
    );
  return (
    <span style={s} className="grid shrink-0 place-items-center">
      <span className={cx("size-2.5 rounded-full border", status === "locked" ? "border-line" : "border-dim")} />
    </span>
  );
}

export function StatusPill({ status }: { status: StageStatus }) {
  const tone: Record<StageStatus, string> = {
    idle: "text-sub bg-raised",
    running: "text-ember bg-ember/10",
    review: "text-review bg-review/10",
    approved: "text-ok bg-ok/10",
    error: "text-bad bg-bad/10",
  };
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full pl-1.5 pr-2.5 text-[12px] font-medium", tone[status])}>
      <StatusGlyph status={status} size={14} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Radio-group segmented control with arrow-key support. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = options.findIndex((o) => o.value === value);
  const move = (d: number) => {
    const next = options[(idx + d + options.length) % options.length]!;
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={cx("grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg border border-line bg-bg p-0.5", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-7 rounded-md px-2 text-[12.5px] font-medium transition-colors duration-150",
              on ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-sub hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200", checked ? "bg-ember" : "bg-line-strong")}
    >
      <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-xl border border-line bg-raised text-sub">{icon}</div>}
      <h3 className="font-display text-[22px] font-normal tracking-[-0.01em] text-fg">{title}</h3>
      {body && <p className="mt-2 max-w-[44ch] text-[13.5px] text-sub">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad/[0.07] px-3.5 py-3 text-[13px] text-fg">
      <IconAlert className="mt-0.5 shrink-0 text-bad" />
      <p className="flex-1">{message}</p>
      {action}
    </div>
  );
}

export function money(usd: number): string {
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
