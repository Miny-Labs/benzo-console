import { EyeOff, Loader2 } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { fmtUsd } from "../lib/format";
import { motion, spring } from "./motion";

export * from "./controls";

/**
 * Surface card — 12px radius, one visible neutral hairline, white on the very light
 * neutral page bg, NO fixed height, no shadow (shadows are reserved for floating
 * things like dropdowns/modals). Default padding is 24px; pass `compact` for the 20px
 * dense variant, or any `p-*`/`px-*` class to take full control (back-compat: a Card
 * that already sets its own padding is left exactly as-is).
 */
export function Card({ children, className = "", compact, ...rest }: { children: ReactNode; className?: string; compact?: boolean } & HTMLAttributes<HTMLDivElement>) {
  // Only apply the default padding when the caller hasn't set its own (p-/px-/py-/pt-…),
  // including responsive variants like `sm:p-4` (where `p` follows a `:`).
  const hasPadding = /(?:^|[\s:])p[xytrbl]?-/.test(className);
  const pad = hasPadding ? "" : compact ? "p-5" : "p-6";
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-border bg-surface ${pad} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Plain explanatory block — NOT a card. Use for prose / technical explanation; caps
 * the reading measure (~720px) so long paragraphs stay legible. The page → card →
 * control hierarchy stays at 3 levels; a Section is page-level, never nested chrome.
 */
export function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`max-w-[720px] ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="font-display t-page-title text-fg">{title}</h1>
        {subtitle ? <p className="t-secondary mt-1">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

type Tone = "muted" | "success" | "warning" | "danger" | "primary" | "shielded";
const TONE: Record<Tone, string> = {
  muted: "bg-border/60 text-muted",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/12 text-danger",
  primary: "bg-primary/10 text-primary",
  shielded: "bg-shielded/12 text-shielded",
};

/** Status pill — ~24px tall, 12px label. */
export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex min-h-[24px] items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Metadata pill — ALWAYS neutral gray. For descriptive tags that are NOT a lifecycle
 * status: tax forms (W9, W8-BEN), "manual", "full", counterparty type, etc. These must
 * never borrow green/purple, which are reserved for confirmed / private-on-chain.
 */
export function MetaPill({ children }: { children: ReactNode }) {
  return <Pill tone="muted">{children}</Pill>;
}

/** Plain-English labels for internal status enums (web2 users don't speak "allowlisted"). */
const STATUS_LABEL: Record<string, string> = {
  allowlisted: "approved",
  pending_screening: "in review",
  needs_approval: "needs approval",
  processing: "sending",
  confirmed: "sent",
  settled: "sent",
  complete: "complete",
  ready: "ready",
  running: "running",
  paused: "paused",
};

/**
 * Status taxonomy → tone. Colour semantics: green = confirmed/paid/completed/approved;
 * amber = waiting / in-review / due-soon / needs-approval; red = failed/revoked/reversed
 * /restricted; gray = neutral (draft, created, unknown). Covers the payment, invoice,
 * payee, auditor-access and blockchain lifecycles. Unknown statuses fall through to
 * neutral so this stays backward-compatible.
 */
const STATUS_SUCCESS = new Set(["confirmed", "settled", "completed", "complete", "paid", "active", "allowlisted", "connected", "approved", "accepted", "verified", "done"]);
const STATUS_WARNING = new Set([
  "needs_approval", "awaiting_approval", "pending", "pending_screening", "in_review", "proving",
  "submitting", "submitted_onchain", "confirming", "processing", "open", "due_soon",
  "expiring", "expiring_soon", "awaiting_kyc", "awaiting_deposit", "partially_paid", "invited", "queued",
  "ready", "running", "paused", "submitted",
]);
const STATUS_DANGER = new Set(["failed", "error", "blocked", "cancelled", "canceled", "expired", "revoked", "overdue", "reversed", "restricted", "suspended", "declined", "rejected"]);

export function statusTone(status: string): Tone {
  if (STATUS_SUCCESS.has(status)) return "success";
  if (STATUS_WARNING.has(status)) return "warning";
  if (STATUS_DANGER.has(status)) return "danger";
  return "muted";
}

/** Maps a money-movement / lifecycle status to a calm tone (red = failure/revoked only). */
export function StatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)}>{STATUS_LABEL[status] ?? status.replace(/_/g, " ")}</Pill>;
}

/** The one calm "private-by-default" indicator. */
export function ShieldedBadge({ label = "Private" }: { label?: string }) {
  return (
    <Pill tone="shielded">
      <EyeOff size={12} /> {label}
    </Pill>
  );
}

/**
 * Money — a tight `$X,XXX.XX` amount. The number renders as ONE solid token, so there
 * are no wide gaps around the `$`, commas or decimal (the tabular-nums-spacing
 * regression). `code` notes the denomination (e.g. "USDC") as a muted suffix where it
 * matters — treasury / summaries. `tabular` opts into fixed-width digits for column
 * alignment inside tables; alignment there is fine, but tightness always wins.
 * `minor` is USDC base units (6dp) as string|bigint — same contract as fmtUsd.
 */
export function Amount({
  minor,
  code,
  decimals = 6,
  tabular = false,
  className = "",
}: {
  minor: string | bigint;
  code?: string;
  decimals?: number;
  tabular?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1 ${tabular ? "tnum" : ""} ${className}`}>
      <span>{fmtUsd(minor, decimals)}</span>
      {code ? <span className="text-[0.82em] font-medium text-muted">{code}</span> : null}
    </span>
  );
}

/** Alias — some surfaces read better as <Money/>. */
export const Money = Amount;

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  loading,
  type = "button",
  size = "md",
  className = "",
  title,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "outline";
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
  /** sm = 32px, md = 40px (default), lg = 44px high-emphasis. */
  size?: "sm" | "md" | "lg";
  className?: string;
  title?: string;
  /** pass-through for data-* / aria-* attributes (e.g. data-testid) */
  [key: `data-${string}`]: string | undefined;
}) {
  const variants: Record<string, string> = {
    primary: "bg-primary text-white hover:opacity-90",
    ghost: "bg-transparent text-fg hover:bg-border/50",
    danger: "bg-danger text-white hover:opacity-90",
    outline: "border border-border bg-transparent text-fg hover:bg-border/40",
  };
  const sizes: Record<string, string> = {
    sm: "min-h-[32px] px-2.5 text-xs",
    md: "min-h-[40px] px-3.5 text-sm",
    lg: "min-h-[44px] px-4 text-sm",
  };
  // Disabled = NEUTRAL GRAY, never a faded-purple primary (which reads as "still
  // clickable"). Applies only to a genuinely-disabled button — a loading button keeps
  // its variant colour so the spinner stays legible.
  const disabledCls =
    disabled && !loading
      ? "!bg-[var(--color-disabled)] !text-[var(--color-disabled-fg)] !shadow-none !border-transparent cursor-not-allowed hover:!opacity-100"
      : "";
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      // calm, console-grade tactile feedback (reduced-motion: framer no-ops it)
      whileTap={disabled || loading ? undefined : { scale: 0.98 }}
      transition={{ ...spring, mass: 0.7 }}
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,opacity,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${variants[variant]} ${sizes[size]} ${disabledCls} ${className}`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </motion.button>
  );
}

/** Button that shows a spinner while `loading` (alias of Button for ergonomics). */
export const LoadingButton = Button;

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card compact>
      <div className="t-label text-muted">{label}</div>
      <div className="t-summary mt-1 text-fg">{value}</div>
      {hint ? <div className="t-helper mt-1">{hint}</div> : null}
    </Card>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="p-10 text-center">
      <div className="text-sm font-medium text-fg">{title}</div>
      {hint ? <div className="mt-1 text-sm text-muted">{hint}</div> : null}
    </Card>
  );
}
