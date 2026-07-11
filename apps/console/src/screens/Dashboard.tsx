/**
 * Dashboard / Overview, calm, dense enterprise-finance home. A compact setup
 * banner (only when setup is unfinished), the private treasury balance, the one
 * approval awaiting the current member, and a real recent-activity table. Amounts
 * follow one rule: •••••• only when the viewer can't see the figure,, when there
 * is no amount, and a "Private on-chain" tag for money that's visible in Benzo but
 * hidden publicly. Everything settles on Avalanche/eERC.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, EyeOff, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import type { ActivityItem, TreasuryView } from "@benzo/types";
import { useConsole } from "../lib/store";
import { USDC_SCALE, fmtDateTime, formatMoney } from "../lib/format";
import { PRIVACY } from "../lib/copy";
import { Screen, Stagger } from "../ui/motion";
import { Amount, Button, Card, PageHeader, Pill, Skeleton, StatusPill, Table, Td, Th } from "../ui/primitives";

/** Count a dollar figure up to its target on load (ease-out-cubic; skipped under reduced-motion). */
function useCountUp(target: number, durationMs = 1000): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (reduce || target <= 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      setValue(target * (1 - (1 - p) ** 3));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, durationMs, reduce]);
  return value;
}

/** "2026-07-08T14:10:00Z" -> "2 hours ago", a calm relative age for submitted-at. */
function timeAgo(ts: string | number | Date): string {
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  // Derive each unit from `diff` directly, deriving hr from the already-rounded
  // min (etc.) compounds rounding and overstates age at boundaries.
  const hr = Math.round(diff / 3_600_000);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(diff / 86_400_000);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(diff / 2_592_000_000);
  return `${mo} month${mo === 1 ? "" : "s"} ago`;
}

function primaryTreasuryMinor(treasury: TreasuryView | null | undefined, fallback = "0"): string {
  return treasury?.balances.find((balance) => balance.token === "usdc")?.amount ?? fallback;
}

/**
 * Setup banner, the bridge from onboarding to first value, collapsed into ONE calm
 * line: "Finish setup, N steps remaining" + the next action's prompt + its CTA.
 * Steps are seeded from REAL store state (not a stored "seen" flag), so each flips to
 * done on its own when the underlying condition is met. Completed steps are disclosed
 * under a small toggle, a muted check + "Completed", never struck through. It
 * auto-hides once everything's done and can be dismissed (persisted).
 */
function SetupBanner() {
  const nav = useNavigate();
  const { treasury, dashboard, members, policies, counterparties, loading } = useConsole();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("benzo.console.firstrun.dismissed") === "1");
  const [showDone, setShowDone] = useState(false);

  // Seed each item from live state, honest, not a stored flag.
  const funded = Number(primaryTreasuryMinor(treasury)) > 0;
  // Maker-checker needs a proposer ≠ approver: more than one member, at least one of
  // whom can approve.
  const canApprove = (r: string) => r === "approver" || r === "admin" || r === "owner";
  const hasApprover = members.length > 1 && members.some((m) => m.status !== "suspended" && canApprove(m.role));
  const hasPolicy = policies.length > 0;
  const hasContractor = counterparties.some((c) => c.type === "contractor");
  const ranPayroll = (dashboard?.scheduledPayrolls ?? 0) > 0 || !!dashboard?.recentActivity.some((a) => a.kind === "payroll");

  const items = [
    { key: "fund", done: funded, title: "Fund your treasury", prompt: "Add USDC so you can run your first payout", cta: "Fund treasury", to: "/treasury" },
    { key: "approver", done: hasApprover, title: "Invite an approver", prompt: "Invite an approver so maker-checker can clear payouts", cta: "Invite approver", to: "/settings" },
    { key: "policy", done: hasPolicy, title: "Review approval policy", prompt: "Review and activate your approval policy", cta: "Review policy", to: "/settings" },
    { key: "contractors", done: hasContractor, title: "Add contractors", prompt: "Add the people you want to pay privately", cta: "Add contractors", to: "/contractors" },
    { key: "payroll", done: ranPayroll, title: "Run your first payroll", prompt: "Run your first private payroll", cta: "Start payroll", to: "/payroll" },
  ] as const;

  const done = items.filter((i) => i.done);
  const remaining = items.filter((i) => !i.done);
  // Hide while the first load is in flight (avoid a flash of all-incomplete), once
  // everything's done, or once the user dismisses it.
  if (dismissed || loading || remaining.length === 0) return null;
  const next = remaining[0];

  function dismiss() {
    localStorage.setItem("benzo.console.firstrun.dismissed", "1");
    setDismissed(true);
  }

  return (
    <Card className="mb-6" data-testid="firstrun-checklist">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck size={16} />
          </span>
          <div className="min-w-0">
            <div className="t-card-title text-fg">
              Finish setup, {remaining.length} step{remaining.length === 1 ? "" : "s"} remaining
            </div>
            <div className="t-helper mt-0.5">{next.prompt}</div>
          </div>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <Button onClick={() => nav(next.to)} data-testid={`firstrun-${next.key}`}>
            {next.cta}
          </Button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss setup"
            data-testid="firstrun-dismiss"
            className="rounded-md p-1.5 text-muted outline-none transition hover:bg-border/50 hover:text-fg focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {done.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            data-testid="firstrun-toggle-done"
            className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted outline-none transition hover:text-fg focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ChevronDown size={14} className={`transition-transform ${showDone ? "rotate-180" : ""}`} />
            Show completed steps ({done.length})
          </button>
          {showDone ? (
            <div className="mt-2.5 space-y-1.5">
              {done.map((it) => (
                <div key={it.key} className="flex items-center gap-2 text-[13px]" data-testid={`firstrun-done-${it.key}`}>
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-border/60 text-muted">
                    <Check size={12} />
                  </span>
                  <span className="text-fg">{it.title}</span>
                  <span className="ml-auto text-muted">Completed</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Business labels for activity kinds, an auditor-grant event reads distinct from a payment. */
const TYPE_LABEL: Record<ActivityItem["kind"], string> = {
  payment: "Payment",
  invoice: "Invoice",
  payroll: "Payroll",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  grant: "Auditor access",
};

/** Where a recent-activity row deep-links. */
function routeForActivity(a: ActivityItem): string {
  switch (a.kind) {
    case "payment":
      return a.status === "needs_approval" ? "/approvals" : "/audit";
    case "invoice":
      return "/invoices";
    case "payroll":
      return "/payroll";
    case "deposit":
    case "withdrawal":
      return "/treasury";
    case "grant":
      return "/grants";
    default:
      return "/audit";
  }
}

/** The one calm "visible in Benzo, hidden publicly" indicator for a money row. */
function PrivateOnChain() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
      <EyeOff size={12} className="text-shielded" />
      {PRIVACY.privateOnChain}
    </span>
  );
}

export function Dashboard() {
  const nav = useNavigate();
  const { dashboard, treasury, payments, counterparties, masked, loading, error, refresh } = useConsole();

  const pending = payments.filter((p) => p.status === "needs_approval");
  const firstPending = pending[0];
  const cpName = firstPending ? counterparties.find((c) => c.id === firstPending.toCounterpartyId)?.name ?? "Recipient" : "";
  const pendingAmount = firstPending
    ? masked || firstPending.privacy.amountHidden
      ? "••••••"
      : formatMoney(firstPending.amount.amount)
    : "";

  // A row is unverified when its backing payment never settled on-chain.
  const unverified = new Set(payments.filter((p) => p.settlement?.onChain === false).map((p) => p.id));
  const activity = dashboard?.recentActivity ?? [];

  const targetDollars = Number(primaryTreasuryMinor(treasury, dashboard?.totalPosition.amount ?? "0")) / USDC_SCALE;
  const animatedTotal = useCountUp(targetDollars);

  /** •••••• (hidden from viewer) ·, (no amount) · the figure (visible). */
  function amountCell(a: ActivityItem) {
    if (a.amountLabel === "-") return <span className="text-muted">-</span>;
    if (masked || a.amountLabel === "Private") return <span className="mask">••••••</span>;
    return <span className="tnum font-medium text-fg">{a.amountLabel}</span>;
  }

  return (
    <Screen>
      <PageHeader title="Overview" subtitle="Manage balances, approvals, payroll, and payments." />

      <SetupBanner />

      {error && !loading ? (
        <Card className="mb-6 flex items-center justify-between gap-4 border-danger/30 bg-danger/5" data-testid="dashboard-error">
          <div className="min-w-0">
            <div className="t-card-title text-danger">Couldn't load your console</div>
            <div className="t-helper mt-0.5 truncate">{error}</div>
          </div>
          <Button variant="outline" className="flex-none" onClick={() => void refresh()} data-testid="dashboard-retry">
            <RefreshCw size={14} /> Retry
          </Button>
        </Card>
      ) : null}

      <Stagger className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {/* Private treasury balance, 7 col */}
        <Stagger.Item index={0} className="lg:col-span-7">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="t-label text-muted">Private treasury balance</div>
              <Pill tone="shielded">
                <ShieldCheck size={12} /> Provable on demand
              </Pill>
            </div>
            {loading ? (
              <Skeleton className="mt-3 h-9 w-52" />
            ) : (
              <div className="t-summary mt-3 text-fg" data-testid="treasury-total">
                {masked ? "••••••" : <Amount minor={String(Math.round(animatedTotal * USDC_SCALE))} />}
              </div>
            )}
            <div className="t-helper mt-2">Across all accounts · public balance not included</div>
          </Card>
        </Stagger.Item>

        {/* Approval awaiting you, 5 col */}
        <Stagger.Item index={1} className="lg:col-span-5">
          <Card className="flex flex-col">
            <div className="t-label text-muted">Approvals</div>
            {pending.length === 0 ? (
              <div className="mt-2">
                <div className="t-card-title text-fg" data-testid="pending-count">
                  No approvals awaiting you
                </div>
                <div className="t-helper mt-1">You're all caught up.</div>
              </div>
            ) : (
              <>
                <div className="t-card-title mt-2 text-fg" data-testid="pending-count">
                  {pending.length} approval{pending.length === 1 ? "" : "s"} awaiting you
                </div>
                <button
                  type="button"
                  onClick={() => nav("/approvals")}
                  className="mt-3 w-full rounded-lg border border-border p-3 text-left outline-none transition hover:bg-border/30 focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <div className="t-body truncate font-medium text-fg">{firstPending.memo ?? "Payment"}</div>
                  <div className="t-helper mt-0.5 truncate">
                    {cpName} · {pendingAmount}
                  </div>
                  <div className="t-helper mt-1">Submitted {timeAgo(firstPending.createdAt)}</div>
                </button>
                {pending.length > 1 ? <div className="t-helper mt-2">+{pending.length - 1} more awaiting you</div> : null}
                <Button className="mt-4 self-start" onClick={() => nav("/approvals")} data-testid="review-approvals">
                  Review {pending.length === 1 ? "approval" : "approvals"} <ArrowRight size={15} />
                </Button>
              </>
            )}
          </Card>
        </Stagger.Item>
      </Stagger>

      {/* Recent activity, full width */}
      <Stagger className="mt-8">
        <Stagger.Item index={2}>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="t-section text-fg">Recent activity</h2>
            <Button variant="ghost" size="sm" onClick={() => nav("/audit")} data-testid="view-all-activity">
              View all activity <ArrowRight size={14} />
            </Button>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Activity</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th align="right">Amount</Th>
                <Th>Privacy</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td className="border-t border-border px-4 py-4" colSpan={6}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : activity.length === 0 ? (
                <tr>
                  <td className="border-t border-border px-4 py-10 text-center text-muted" colSpan={6}>
                    No activity yet.
                  </td>
                </tr>
              ) : (
                activity.map((a) => (
                  <tr
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${a.title}, view details`}
                    onClick={() => nav(routeForActivity(a))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        nav(routeForActivity(a));
                      }
                    }}
                    data-testid="activity-row"
                    className="h-[62px] cursor-pointer outline-none transition hover:bg-border/30 focus-visible:bg-border/40"
                  >
                    <Td className="whitespace-nowrap text-muted">{fmtDateTime(a.at)}</Td>
                    <Td className="font-medium text-fg">{a.title}</Td>
                    <Td className="text-muted">{TYPE_LABEL[a.kind] ?? a.kind}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusPill status={a.status} />
                        {unverified.has(a.id) ? <Pill tone="warning">Unverified</Pill> : null}
                      </span>
                    </Td>
                    <Td align="right">{amountCell(a)}</Td>
                    <Td>{a.kind === "grant" ? <span className="text-muted">-</span> : <PrivateOnChain />}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Stagger.Item>
      </Stagger>
    </Screen>
  );
}
