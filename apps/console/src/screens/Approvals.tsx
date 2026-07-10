/**
 * Approvals — the dual-control release gate. Each payment awaiting approval reads as
 * a structured three-area row: what it is (memo, counterparty, reference, proposer),
 * where it stands (M-of-N progress, policy, privacy, risk), and the decision (amount,
 * Deny, Approve). Denying requires a reason; approving that satisfies the policy
 * confirms it will submit the payment on-chain. Calm tones; red is failure/denial only.
 */
import { useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import type { ApprovalPolicy, PaymentOrder } from "@benzo/types";
import { api } from "../lib/api";
import { useConsole, useCounterpartyName } from "../lib/store";
import { fmtDate, fmtUsd, explorerTxUrl, friendlyError } from "../lib/format";
import { NETWORK_ENV, NETWORK_LABEL } from "../lib/network";
import { policySummary, totalApprovers } from "../lib/policy";
import { AnimatePresence, EASE, Screen, motion } from "../ui/motion";
import {
  Button,
  Card,
  EmptyState,
  MetaPill,
  Modal,
  PageHeader,
  Pill,
  ShieldedBadge,
  Skeleton,
  StatusPill,
  Table,
  Td,
  Th,
  Tr,
  Textarea,
  useToast,
} from "../ui/primitives";

/** Anything over this proposed amount is flagged high-value in the risk lane. */
const HIGH_VALUE = 10_000n * 1_000_000n;

/** "…on-chain" network prose without doubling "Mainnet" on a mainnet build. */
const NETWORK_PROSE = `${NETWORK_LABEL}${NETWORK_ENV.kind === "mainnet" ? "" : ` ${NETWORK_ENV.badge}`}`;

/** "2 hours ago" — a calm relative age for a proposed-at timestamp. */
function timeAgo(ts: string | number | Date): string {
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return "";
  const min = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/** The policy governing a payment: its own policy id, else the first matching by amount. */
function matchPolicy(p: PaymentOrder, policies: ApprovalPolicy[]): ApprovalPolicy | undefined {
  if (p.approvalPolicyId) {
    const byId = policies.find((x) => x.id === p.approvalPolicyId);
    if (byId) return byId;
  }
  const amount = BigInt(p.amount.amount);
  const matches = policies.filter((pol) =>
    pol.conditions.every((c) => {
      if (c.field !== "amount" || Array.isArray(c.value)) return true;
      const v = BigInt(c.value || "0");
      switch (c.operator) {
        case "gt": return amount > v;
        case "gte": return amount >= v;
        case "lt": return amount < v;
        case "lte": return amount <= v;
        case "eq": return amount === v;
        default: return true;
      }
    }),
  );
  // Overlapping ranges → prefer the MOST-SPECIFIC policy (most amount conditions),
  // deterministically, rather than whichever happened to be first in the array.
  const amountConds = (pol: ApprovalPolicy) => pol.conditions.filter((c) => c.field === "amount").length;
  return matches.sort((a, b) => amountConds(b) - amountConds(a))[0];
}

/** Segmented M-of-N progress — filled segments for recorded approvals. */
function Progress({ have, need }: { have: number; need: number }) {
  return (
    <div data-testid="approval-progress">
      <div className="t-body font-medium text-fg">
        {have} of {need} approval{need === 1 ? "" : "s"}
      </div>
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: Math.max(need, 1) }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < have ? "bg-success" : "bg-border"}`} />
        ))}
      </div>
    </div>
  );
}

export function Approvals() {
  const toast = useToast();
  const { payments, members, policies, masked, refresh, loading } = useConsole();
  const name = useCounterpartyName();
  const [busy, setBusy] = useState<string | null>(null);
  // Track WHICH action is in flight so the row's Approve/Deny spinners key off the
  // real action, not the unrelated deny-dialog (`denyFor`) state.
  const [busyAction, setBusyAction] = useState<"approve" | "deny" | null>(null);
  const [confirm, setConfirm] = useState<{ p: PaymentOrder; willRelease: boolean } | null>(null);
  const [denyFor, setDenyFor] = useState<PaymentOrder | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const memberRole = (id: string) => members.find((m) => m.id === id)?.role ?? "";

  const pending = payments.filter((p) => p.status === "needs_approval");
  const decided = payments.filter((p) => p.status !== "needs_approval");

  async function decide(p: PaymentOrder, decision: "approved" | "denied", comment?: string) {
    setBusy(p.id);
    setBusyAction(decision === "denied" ? "deny" : "approve");
    try {
      const updated = await api.approvePayment(p.id, { decision, comment });
      const prog = updated.progress;
      if (decision === "denied") {
        toast({ title: "Payment denied", tone: "muted" });
      } else if (prog?.satisfied) {
        toast({
          title: updated.settlement?.onChain ? "Released and paid" : "Release failed before on-chain settlement",
          tone: updated.settlement?.onChain ? "success" : "danger",
        });
      } else {
        toast({ title: `Approved · now needs ${prog?.nextRole ?? "another approver"}${prog?.nextKind === "release" ? " to release" : ""}`, tone: "success" });
      }
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
      setBusyAction(null);
      setConfirm(null);
      setDenyFor(null);
      setDenyReason("");
    }
  }

  return (
    <Screen>
      <PageHeader
        title="Approvals"
        subtitle={`Release gated payments. Each one settles a real shielded transfer on ${NETWORK_LABEL}.`}
      />

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Card key={i}>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-10 w-56 max-w-full rounded-lg" />
                </div>
                <div className="flex flex-col items-end gap-3">
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-8 w-40" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : pending.length === 0 ? (
        <EmptyState title="All clear" hint="No payments are waiting on your approval." />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {pending.map((p, i) => {
              const policy = matchPolicy(p, policies);
              const approvedTrail = (p.approvals ?? []).filter((a) => a.decision === "approved");
              const have = approvedTrail.length;
              const knownNeed = policy ? totalApprovers(policy) : null;
              // Only claim this approval RELEASES the payment when the threshold is
              // actually known — an unresolved policy must not over-promise a settle.
              const willRelease = knownNeed != null && have + 1 >= knownNeed;
              const need = knownNeed ?? Math.max(have + 1, 2); // display fallback for the progress bar
              const risky = BigInt(p.amount.amount) > HIGH_VALUE;
              return (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 28, scale: 0.97 }}
                  transition={{ duration: 0.32, ease: EASE, delay: i * 0.04 }}
                >
                  <Card data-testid="approval-card">
                    <div className="grid gap-5 md:grid-cols-[1fr_auto_auto] md:items-start">
                      {/* Left — what it is */}
                      <div className="min-w-0">
                        <div className="t-card-title truncate text-fg">{p.memo ?? "Payment"}</div>
                        <div className="t-secondary mt-0.5">
                          To {name(p.toCounterpartyId)} · {p.type.replace(/_/g, " ")}
                        </div>
                        {p.ref ? <div className="t-helper mt-1">Reference {p.ref}</div> : null}
                        <div className="t-helper mt-2">
                          Proposed by {memberName(p.createdByMemberId)}
                          {memberRole(p.createdByMemberId) ? ` · ${memberRole(p.createdByMemberId)}` : ""} · {timeAgo(p.createdAt)}
                        </div>
                      </div>

                      {/* Middle — where it stands */}
                      <div className="space-y-2.5 md:w-60 md:border-l md:border-border md:pl-5">
                        <Progress have={have} need={need} />
                        {have > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5" data-testid="approval-trail">
                            {approvedTrail.map((a) => (
                              <Pill key={a.id} tone="success">
                                <Check size={11} /> {memberName(a.approverMemberId)}
                              </Pill>
                            ))}
                          </div>
                        ) : (
                          <div className="t-helper">The proposer cannot approve this payment.</div>
                        )}
                        <div className="t-helper">{policy ? policySummary(policy) : `Requires ${need} approvals to release.`}</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ShieldedBadge label="Private on-chain" />
                          {risky ? <Pill tone="warning">High value</Pill> : <MetaPill>Standard risk</MetaPill>}
                        </div>
                      </div>

                      {/* Right — the decision */}
                      <div className="flex flex-col items-end gap-3 md:w-44 md:pl-5">
                        <div className="font-display tnum text-2xl font-semibold text-fg" data-testid="approval-amount">
                          {masked || p.privacy.amountHidden ? "••••••" : fmtUsd(p.amount.amount)}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="!border-danger/40 !text-danger hover:!bg-danger/8"
                            loading={busy === p.id && busyAction === "deny"}
                            onClick={() => {
                              setDenyReason("");
                              setDenyFor(p);
                            }}
                            data-testid="deny-btn"
                          >
                            <X size={15} /> Deny
                          </Button>
                          <Button
                            loading={busy === p.id && busyAction === "approve"}
                            onClick={() => setConfirm({ p, willRelease })}
                            data-testid="approve-btn"
                          >
                            <Check size={15} /> Approve
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {decided.length > 0 ? (
        <div className="mt-8">
          <h2 className="t-label mb-2 text-muted">Recently decided</h2>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Payment</Th>
                <Th>Decision</Th>
                <Th>Decided by</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Receipt</Th>
              </tr>
            </thead>
            <tbody>
              {decided.slice(0, 8).map((p) => {
                const last = (p.approvals ?? []).slice(-1)[0];
                const approved = p.status === "confirmed" || p.status === "settled";
                const denied = p.status === "cancelled";
                return (
                  <Tr key={p.id}>
                    <Td>{fmtDate(p.updatedAt)}</Td>
                    <Td>
                      <div className="font-medium text-fg">{p.memo ?? "Payment"}</div>
                      <div className="t-helper">{name(p.toCounterpartyId)}</div>
                    </Td>
                    <Td>
                      {approved ? (
                        <Pill tone="success">Approved</Pill>
                      ) : denied ? (
                        <MetaPill>Denied</MetaPill>
                      ) : (
                        <StatusPill status={p.status} />
                      )}
                    </Td>
                    <Td>{last ? `${memberName(last.approverMemberId)}${memberRole(last.approverMemberId) ? ` · ${memberRole(last.approverMemberId)}` : ""}` : "—"}</Td>
                    <Td align="right" className="tnum">
                      {masked || p.privacy.amountHidden ? "••••••" : fmtUsd(p.amount.amount)}
                    </Td>
                    <Td align="right">
                      {p.settlement?.txHash ? (
                        <a
                          href={explorerTxUrl(p.settlement.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          Receipt <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ) : null}

      {/* Approve confirm — releases explicitly say what happens on-chain. */}
      <Modal
        open={!!confirm}
        onClose={() => busy === null && setConfirm(null)}
        title="Approve payment"
        footer={
          confirm ? (
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy !== null}>
                Cancel
              </Button>
              <Button loading={busy === confirm.p.id} onClick={() => decide(confirm.p, "approved")} data-testid="approve-confirm">
                {confirm.willRelease ? "Approve & release" : "Record approval"}
              </Button>
            </>
          ) : null
        }
      >
        {confirm ? (
          <p className="t-body text-fg">
            {confirm.willRelease ? (
              <>
                Approving will satisfy the policy and submit this payment on <strong>{NETWORK_PROSE}</strong>. The amount and
                recipient stay private on-chain.
              </>
            ) : (
              <>Record your approval. This payment still needs more approvals before it can be released.</>
            )}
          </p>
        ) : null}
      </Modal>

      {/* Deny requires a reason. */}
      <Modal
        open={!!denyFor}
        onClose={() => busy === null && setDenyFor(null)}
        title="Deny payment"
        footer={
          denyFor ? (
            <>
              <Button variant="ghost" onClick={() => setDenyFor(null)} disabled={busy !== null}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={busy === denyFor.id}
                disabled={!denyReason.trim()}
                onClick={() => decide(denyFor, "denied", denyReason.trim())}
                data-testid="deny-confirm"
              >
                Deny payment
              </Button>
            </>
          ) : null
        }
      >
        <div className="flex flex-col gap-3">
          <p className="t-helper">A reason is recorded in the audit trail and shared with the proposer.</p>
          <Textarea
            label="Reason for denial"
            placeholder="e.g. Duplicate of PO-4480 — already paid."
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            data-testid="deny-reason"
          />
        </div>
      </Modal>
    </Screen>
  );
}
