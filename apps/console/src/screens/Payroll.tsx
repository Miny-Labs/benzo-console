/**
 * Payroll - confidential batch runs. Each batch hides individual salaries on-chain
 * (one shielded transfer per person) while the employer can still prove the total.
 *
 * Presentation is calm dense enterprise-finance: every run is a TABLE ROW
 * (Period · People · Total · Approval · Settlement · Actions), not a giant card.
 * Crypto/proof detail lives behind a "Technical details" disclosure inside the
 * per-run detail drawer.
 *
 * The run flow is unchanged: "Approve & run" is ONE animated pass that proves
 * funded (ORGBAL) + policy (SPENDCAP/screen) + computation (PAYCOMP) + anonymous
 * approval (ORGAUTH) and settles the batch, shown through the shared full-screen
 * send ceremony with per-recipient progress. The row action reads "Approve" when
 * this operator's approval is NOT the final required one (nothing settles yet) and
 * "Approve & run" only when it settles the run. Run creation lives here too.
 */
import { useEffect, useReducer, useState, type ReactNode } from "react";
import { Check, CheckCheck, ChevronDown, Download, Plus, ReceiptText, ShieldCheck, Users } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import type { ApprovalPolicy, PayrollBatch, PayrollLine } from "@benzo/types";
import { initialPaymentState, type PaymentPhase, paymentReducer } from "@benzo/ui/payment-state";
import { api, type OnChainRef } from "../lib/api";
import { useConsole, useCounterpartyName } from "../lib/store";
import { explorerTxUrl, fmtUsd, friendlyError } from "../lib/format";
import { AnimatePresence, EASE, Screen, motion, spring } from "../ui/motion";
import { OnChainDetail } from "../ui/onchain";
import { SendCeremony } from "../ui/SendCeremony";
import {
  Amount, Button, EmptyState, Input, Modal, PageHeader, Pill,
  Skeleton, StatusPill, Table, Td, Th, Tr, useToast,
} from "../ui/primitives";

/** On-chain refs captured from the automated pass, per proof, for the receipt drill-down. */
type RunRefs = { funded?: OnChainRef; approval?: OnChainRef; computation?: OnChainRef };
/** What actually settled, surfaced in the ceremony receipt. */
type RunOutcome = { total: number; paid: number; failed: number; onChain: boolean; txHash?: string; unverifiedPolicy?: number };

const period = () => new Date().toISOString().slice(0, 7); // e.g. 2026-06

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-07" (or "2026-07 payroll") → "July 2026". Unrecognised labels pass through. */
function monthYear(label: string): string {
  const m = /(\d{4})-(\d{1,2})/.exec(label);
  if (!m) return label.replace(/payroll/gi, "").trim() || label;
  return `${MONTHS_LONG[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

const approvedCount = (b: PayrollBatch) => (b.approvals ?? []).filter((a) => a.decision === "approved").length;
const hasFailed = (b: PayrollBatch) => b.lines.some((l) => l.status === "failed");

/**
 * Best-effort required-approver count so the row action can predict whether THIS
 * approval settles the run. Prefers a proven threshold, then the org's approval
 * policy (stage minimums + release gate), and defaults to a single approval. The
 * runtime stays honest regardless: a non-final approval closes the ceremony
 * without ever claiming a settlement it didn't do.
 */
function requiredApprovers(b: PayrollBatch, policies: ApprovalPolicy[]): number {
  if (b.approvalProof?.threshold) return b.approvalProof.threshold;
  const list = policies ?? [];
  // No per-batch policy link exists, so predict from the policy that ALWAYS
  // applies (empty conditions = catch-all) rather than arbitrary array order.
  // The runtime still enforces the real threshold regardless.
  const pol = list.find((p) => p.conditions.length === 0) ?? list[0];
  if (pol) return Math.max(1, pol.steps.reduce((s, st) => s + st.minApprovers, 0) + (pol.releaseGate?.minApprovers ?? 0));
  return 1;
}
/** Does this operator's approval settle the run (approvals already met, or this one reaches the threshold)? */
function settlesOnApprove(b: PayrollBatch, policies: ApprovalPolicy[]): boolean {
  return b.status === "approved" || approvedCount(b) + 1 >= requiredApprovers(b, policies);
}
/** Precise row action label: "Retry failed" · "Approve" (not final) · "Approve & run" (settles). */
function rowAction(b: PayrollBatch, policies: ApprovalPolicy[]): string {
  if (b.status === "processing" && hasFailed(b)) return "Retry failed";
  return settlesOnApprove(b, policies) ? "Approve & run" : "Approve";
}

/** One primary status per dimension, in plain money-movement language. */
function approvalStatus(b: PayrollBatch): string {
  if (b.status === "draft") return "draft";
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "needs_approval") return "awaiting_approval";
  return "approved"; // approved · processing · completed
}
function settlementStatus(b: PayrollBatch): string {
  if (b.status === "completed") return "completed";
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "processing") return hasFailed(b) ? "failed" : "processing";
  return "not_started"; // draft · needs_approval · approved
}

export function Payroll() {
  const toast = useToast();
  const { payrolls, counterparties, policies, masked, refresh, loading } = useConsole();
  const name = useCounterpartyName();
  // Count recipients with no on-chain payout material on file - those lines can't
  // settle privately, so the approver sees it BEFORE an irreversible run, not after.
  const unpayableIds = (b: PayrollBatch) =>
    new Set(b.lines.filter((l) => !counterparties.find((c) => c.id === l.counterpartyId)?.paymentAddress?.shielded).map((l) => l.counterpartyId));
  const unpayableCount = (b: PayrollBatch) => unpayableIds(b).size;
  const visiblePayrolls = [...payrolls].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  // Allowlisted contractors with a rate card = the roster a New run pulls from.
  const payableContractors = counterparties.filter((c) => c.type === "contractor" && c.payRate && c.status === "allowlisted");

  const [cap, setCap] = useState("5000.00");
  const [creating, setCreating] = useState(false);
  // Detail drawer target (batch id) - opened by the row "Details" action and by the
  // ceremony's "View register".
  const [open, setOpen] = useState<string | null>(null);
  // Confirm gate for the highest-value irreversible action (Approve & run).
  const [confirmRun, setConfirmRun] = useState<PayrollBatch | null>(null);
  // On-chain refs captured from this session's automated pass, keyed by batch id.
  const [refs, setRefs] = useState<Record<string, RunRefs>>({});
  // The single full-screen ceremony, driven by the shared payment-state machine.
  const [paymentState, dispatchPayment] = useReducer(paymentReducer, initialPaymentState);
  const [ceremonyBatch, setCeremonyBatch] = useState<PayrollBatch | null>(null);
  const [runOutcome, setRunOutcome] = useState<RunOutcome | null>(null);
  const ceremonyOpen = paymentState.phase !== "idle";
  const activeRefs = ceremonyBatch ? refs[ceremonyBatch.id] : undefined;
  const drawerBatch = open ? visiblePayrolls.find((b) => b.id === open) ?? null : null;

  // One click = one approval step, but that approval automatically proves
  // funded + policy + computation + anonymous-approval and settles when it's the
  // final required step. The whole thing is a single animated pass; the ceremony
  // fails clearly if settlement doesn't happen, never claiming a settle it didn't do.
  async function approveAndRun(b: PayrollBatch) {
    setCeremonyBatch(b);
    setRunOutcome(null);
    dispatchPayment({ type: "START" }); // building
    dispatchPayment({ type: "WITNESS_READY" }); // proving each salary private
    const captured: RunRefs = {};
    try {
      // Fold the four manual proofs into the pass. funded/policy/computation are
      // independent on-chain pre-flight proofs - prove them together.
      const [funded, policy, computation] = await Promise.all([
        api.proveFunded(b.id),
        api.provePolicy(b.id, cap),
        api.proveComputation(b.id),
      ]);
      if (funded.ref) captured.funded = funded.ref;
      if (computation.ref) captured.computation = computation.ref;

      // In-ZK spending policy (Z3 cap + Z4 sanctions), proven per line. A provable
      // hard block - over the cap or sanctioned - stops the run BEFORE it settles
      // rather than quietly paying it; proofs that didn't reach the chain are
      // carried into the receipt as a note. Amounts/recipients stay hidden.
      const policyLines = policy.lines ?? [];
      const over = policyLines.filter((l) => l.capProof?.onChain && !l.capProof.withinCap).length;
      const flagged = policyLines.filter((l) => l.screenProof?.onChain && !l.screenProof.innocent).length;
      const unverifiedPolicy = policyLines.filter((l) => (l.capProof && !l.capProof.onChain) || (l.screenProof && !l.screenProof.onChain)).length;
      if (over || flagged) {
        const summary = [over ? `${over} over the ${cap} cap` : "", flagged ? `${flagged} sanctioned` : ""].filter(Boolean).join(", ");
        setRefs((m) => ({ ...m, [b.id]: { ...m[b.id], ...captured } }));
        toast({ title: `Policy blocked this run: ${summary}`, tone: "danger" });
        dispatchPayment({ type: "FAIL", error: `Policy blocked this run: ${summary}. No payouts settled - fix the flagged lines and retry.` });
        await refresh();
        return;
      }

      // The click is this operator's approval (proposer != approver, enforced
      // server-side). It settles only when every step + the release gate pass.
      const approved = await api.approvePayroll(b.id);
      const prog = approved.progress;
      if (prog && !prog.satisfied) {
        // Not the final step - an approval was recorded, nothing settled. Be honest:
        // close the ceremony rather than animate a settlement that didn't occur.
        setRefs((m) => ({ ...m, [b.id]: { ...m[b.id], ...captured } }));
        dispatchPayment({ type: "RESET" });
        toast({ title: `Approved · now needs ${prog.nextRole}${prog.nextKind === "release" ? " to release" : ""}`, tone: "success" });
        await refresh();
        return;
      }

      // Final approval - prove the anonymous approver threshold (ORGAUTH), then
      // reflect the real settlement outcome through the ceremony.
      const approval = await api.proveApproval(b.id);
      if (approval.ref) captured.approval = approval.ref;
      setRefs((m) => ({ ...m, [b.id]: { ...m[b.id], ...captured } }));

      // Point the ceremony at the SETTLED batch, not the pending draft we opened
      // with, so the per-recipient roster reflects real paid/failed states.
      setCeremonyBatch(approved);
      dispatchPayment({ type: "PROOF_READY" }); // submitting N transfers
      const settledTx = approved.lines.find((l) => l.txHash)?.txHash ?? "";
      dispatchPayment({ type: "SUBMITTED", txHash: settledTx });

      const failed = approved.lines.filter((l) => l.status === "failed").length;
      const paid = approved.lines.filter((l) => l.status === "paid").length;
      const onChain = approved.lines.some((l) => l.onChain);
      setRunOutcome({ total: approved.lines.length, paid, failed, onChain, txHash: settledTx || undefined, unverifiedPolicy });

      if (failed || !onChain) {
        dispatchPayment({
          type: "FAIL",
          error: failed ? `${failed} payout${failed === 1 ? "" : "s"} didn't settle. Fix and retry.` : "Payroll did not settle on-chain.",
        });
      } else {
        dispatchPayment({ type: "CONFIRMED", result: approved });
      }
      await refresh();
    } catch (e) {
      dispatchPayment({ type: "FAIL", error: friendlyError(e) });
      await refresh();
    }
  }

  function closeCeremony() {
    dispatchPayment({ type: "RESET" });
    setCeremonyBatch(null);
    setRunOutcome(null);
  }

  // New run - amounts are COMPUTED server-side from each rate card; we only pick who's in.
  async function createRun() {
    if (payableContractors.length === 0) {
      toast({ title: "No payable contractors on the roster yet. Add rates in Contractors first.", tone: "danger" });
      return;
    }
    setCreating(true);
    try {
      const batch = await api.createPayroll({
        period: period(),
        source: "manual",
        lines: payableContractors.map((c) => ({ counterpartyId: c.id })),
      });
      toast({ title: `${monthYear(period())} run drafted · ${batch.lines.length} contractor${batch.lines.length === 1 ? "" : "s"} · ${fmtUsd(batch.total.amount)}`, tone: "success" });
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setCreating(false);
    }
  }

  function download(fileName: string, text: string, type: string) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPayslips(b: PayrollBatch) {
    const rows = b.lines.map((l) => ({
      period: b.period,
      contractor: name(l.counterpartyId),
      gross: l.amount,
      status: l.status,
      txHash: l.txHash,
      error: l.error,
    }));
    download(`benzo-payslips-${b.period}.json`, JSON.stringify(rows, null, 2), "application/json");
  }

  function exportCsv(b: PayrollBatch) {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["period", "contractor", "amount_units", "status", "tx_hash", "error"],
      ...b.lines.map((l) => [b.period, name(l.counterpartyId), l.amount, l.status, l.txHash ?? "", l.error ?? ""]),
    ];
    download(`benzo-payroll-${b.period}.csv`, rows.map((r) => r.map(esc).join(",")).join("\n"), "text/csv");
  }

  return (
    <Screen>
      <SendCeremony
        open={ceremonyOpen}
        state={paymentState}
        eyebrow={ceremonyBatch ? `${monthYear(ceremonyBatch.period)} payroll run` : "Payroll run"}
        details={
          ceremonyBatch ? (
            <CeremonyRoster batch={ceremonyBatch} name={name} masked={masked} phase={paymentState.phase} unpayable={unpayableIds(ceremonyBatch)} />
          ) : undefined
        }
        receipt={
          runOutcome ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 font-semibold text-white">
                <ReceiptText size={15} /> {runOutcome.failed ? `${runOutcome.paid}/${runOutcome.total} settled` : `${runOutcome.paid} paid privately`}
              </div>
              <p className="text-white/56">
                {runOutcome.onChain
                  ? "Each salary settled privately on-chain. The total stays provable to an auditor; the individual amounts don't leak."
                  : "No on-chain settlement was recorded for this run."}
              </p>
              {runOutcome.unverifiedPolicy ? (
                <p className="text-warning" data-testid="policy-unverified-note">
                  {runOutcome.unverifiedPolicy} policy proof{runOutcome.unverifiedPolicy === 1 ? "" : "s"} didn't verify on-chain - re-check before you rely on this run.
                </p>
              ) : null}
              {activeRefs && (activeRefs.funded || activeRefs.approval || activeRefs.computation) ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 pt-2.5">
                  {activeRefs.funded ? <OnChainDetail refData={activeRefs.funded} label="Funded proof" /> : null}
                  {activeRefs.approval ? <OnChainDetail refData={activeRefs.approval} label="Approval proof" /> : null}
                  {activeRefs.computation ? <OnChainDetail refData={activeRefs.computation} label="Computation proof" /> : null}
                </div>
              ) : null}
            </div>
          ) : undefined
        }
        primaryAction={
          paymentState.phase === "confirmed" || paymentState.phase === "failed"
            ? {
                label: paymentState.phase === "confirmed" ? "Done" : "Close",
                onClick: closeCeremony,
                variant: paymentState.phase === "failed" ? "danger" : "primary",
              }
            : undefined
        }
        secondaryAction={
          (paymentState.phase === "confirmed" || paymentState.phase === "failed") && ceremonyBatch
            ? {
                label: "View register",
                onClick: () => {
                  const id = ceremonyBatch.id;
                  closeCeremony();
                  setOpen(id);
                },
                variant: "outline",
              }
            : undefined
        }
      />

      <PageHeader
        title="Payroll"
        subtitle="Salaries private on-chain · total provable to an auditor"
        action={
          <Button onClick={createRun} loading={creating} disabled={payableContractors.length === 0} data-testid="new-run">
            <Plus size={15} /> New run
          </Button>
        }
      />

      {loading ? (
        <Table>
          <thead>
            <tr>
              <Th>Period</Th>
              <Th align="right">People</Th>
              <Th align="right">Total</Th>
              <Th>Approval</Th>
              <Th>Settlement</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2].map((i) => (
              <Tr key={i}>
                <Td><Skeleton className="h-4 w-32" /></Td>
                <Td align="right"><Skeleton className="ml-auto h-4 w-6" /></Td>
                <Td align="right"><Skeleton className="ml-auto h-4 w-20" /></Td>
                <Td><Skeleton className="h-6 w-24" /></Td>
                <Td><Skeleton className="h-6 w-20" /></Td>
                <Td align="right"><Skeleton className="ml-auto h-8 w-28" /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : payrolls.length === 0 ? (
        <EmptyState
          title="No payroll runs yet"
          hint={payableContractors.length ? `New run pulls your ${payableContractors.length} allowlisted contractor${payableContractors.length === 1 ? "" : "s"} - amounts are computed from their rate cards.` : "Add allowlisted contractors with rate cards, then start a run here."}
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 t-helper">
            <ShieldCheck size={13} className="flex-none text-primary" />
            Payroll runs after funding and approval checks pass.
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th align="right">People</Th>
                <Th align="right">Total</Th>
                <Th>Approval</Th>
                <Th>Settlement</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visiblePayrolls.map((b) => {
                const runnable = b.status === "needs_approval" || b.status === "approved" || b.status === "processing";
                const partialApprovals = b.status === "needs_approval" && approvedCount(b) > 0;
                return (
                  <Tr key={b.id}>
                    <Td>
                      <div className="font-medium text-fg">{monthYear(b.period)} payroll</div>
                      <div className="t-helper mt-0.5">via {b.source}</div>
                    </Td>
                    <Td align="right" className="tnum text-muted">{b.lines.length}</Td>
                    <Td align="right">
                      <span data-testid="payroll-total">
                        {masked ? <span className="mask">••••</span> : <Amount minor={b.total.amount} tabular />}
                      </span>
                    </Td>
                    <Td>
                      <StatusPill status={approvalStatus(b)} />
                      {partialApprovals ? (
                        <div className="t-helper mt-1">{approvedCount(b)} of {requiredApprovers(b, policies)} signed</div>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusPill status={settlementStatus(b)} />
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-2">
                        {runnable ? (
                          <Button size="sm" onClick={() => setConfirmRun(b)} data-testid="run-payroll">
                            <CheckCheck size={14} /> {rowAction(b, policies)}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => setOpen(b.id)} data-testid="open-details">
                          Details
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      {/* Per-run detail drawer: full register + downloads + the crypto/proof detail
          folded behind a "Technical details" disclosure. */}
      <Modal
        open={!!drawerBatch}
        onClose={() => setOpen(null)}
        width="max-w-2xl"
        title={
          drawerBatch ? (
            <span className="inline-flex items-center gap-2">
              <Users size={15} className="text-primary" /> {monthYear(drawerBatch.period)} payroll
            </span>
          ) : (
            "Payroll run"
          )
        }
      >
        {drawerBatch ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={approvalStatus(drawerBatch)} />
                <StatusPill status={settlementStatus(drawerBatch)} />
                {drawerBatch.status === "processing" && hasFailed(drawerBatch) ? (
                  <span className="t-helper text-danger" data-testid="payroll-failed-note">Some payouts didn't settle - retry from the run row.</span>
                ) : null}
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => downloadPayslips(drawerBatch)} className="inline-flex items-center gap-1 rounded text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40" data-testid="download-payslips" type="button">
                  <Download size={13} /> Payslips
                </button>
                <button onClick={() => exportCsv(drawerBatch)} className="inline-flex items-center gap-1 rounded text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40" data-testid="export-csv" type="button">
                  <Download size={13} /> Export CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Fact label="Recipients" value={drawerBatch.lines.length} />
              <Fact label="Total" value={masked ? <span className="mask">••••</span> : <Amount minor={drawerBatch.total.amount} />} />
              <Fact label="Source" value={<span className="capitalize">{drawerBatch.source}</span>} />
            </div>

            <div>
              <div className="t-label mb-2 text-muted">Run register</div>
              <Table>
                <thead>
                  <tr>
                    <Th>Recipient</Th>
                    <Th>Policy</Th>
                    <Th>Status</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {drawerBatch.lines.map((l, li) => (
                    <Tr key={li}>
                      <Td>
                        <div className="text-fg">{name(l.counterpartyId)}</div>
                        {l.status === "failed" && l.error ? <div className="t-helper text-danger">{l.error}</div> : null}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          {l.capProof ? (
                            <Pill tone={!l.capProof.onChain ? "warning" : l.capProof.withinCap ? "shielded" : "danger"}>
                              <ShieldCheck size={10} /> {!l.capProof.onChain ? "cap unverified" : l.capProof.withinCap ? "within cap" : "over cap"}
                            </Pill>
                          ) : null}
                          {l.screenProof ? (
                            <Pill tone={!l.screenProof.onChain ? "warning" : l.screenProof.innocent ? "shielded" : "danger"}>
                              <ShieldCheck size={10} /> {!l.screenProof.onChain ? "screening unverified" : l.screenProof.innocent ? "not sanctioned" : "sanctioned"}
                            </Pill>
                          ) : null}
                          {!l.capProof && !l.screenProof ? <span className="t-helper">—</span> : null}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          {l.status === "paid" && !l.onChain ? <Pill tone="warning">not on-chain</Pill> : <StatusPill status={l.status} />}
                          {l.txHash ? (
                            <a href={explorerTxUrl(l.txHash)} target="_blank" rel="noreferrer" className="rounded text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">receipt</a>
                          ) : null}
                        </div>
                      </Td>
                      <Td align="right">{masked ? <span className="mask">••••</span> : <Amount minor={l.amount} tabular />}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <TechnicalDetails batch={drawerBatch} refs={refs[drawerBatch.id]} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!confirmRun}
        onClose={() => setConfirmRun(null)}
        title={
          confirmRun
            ? confirmRun.status === "processing"
              ? "Retry failed payouts"
              : settlesOnApprove(confirmRun, policies)
                ? "Approve & run this payroll"
                : "Approve this payroll run"
            : ""
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRun(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const b = confirmRun;
                if (!b) return;
                setConfirmRun(null);
                void approveAndRun(b);
              }}
              data-testid="run-payroll-confirm"
            >
              <CheckCheck size={15} /> {confirmRun ? rowAction(confirmRun, policies) : "Approve & run"}
            </Button>
          </>
        }
      >
        {confirmRun ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {confirmRun.status === "processing" ? (
                <>Retry the payouts that didn't settle on the <b>{monthYear(confirmRun.period)}</b> run. Successful lines are not paid twice.</>
              ) : confirmRun.status === "approved" ? (
                <>All approvals are already in for the <b>{monthYear(confirmRun.period)}</b> run. This settles the real on-chain payouts and <b>can't be undone</b>.</>
              ) : settlesOnApprove(confirmRun, policies) ? (
                <>This is your final approval for the <b>{monthYear(confirmRun.period)}</b> run. It proves funded, policy, computation and approval, then settles real on-chain payouts and <b>can't be undone</b>.</>
              ) : (
                <>This records your approval for the <b>{monthYear(confirmRun.period)}</b> run. It still needs {Math.max(1, requiredApprovers(confirmRun, policies) - approvedCount(confirmRun) - 1)} more approver{requiredApprovers(confirmRun, policies) - approvedCount(confirmRun) - 1 === 1 ? "" : "s"} before anything settles - <b>no payouts move yet</b>.</>
              )}
            </p>
            <div className="space-y-2 rounded-xl bg-bg p-4 text-[14px]">
              <div className="flex justify-between"><span className="text-muted">Recipients</span><span className="font-semibold">{confirmRun.lines.length}</span></div>
              <div className="flex justify-between"><span className="text-muted">Total</span><span className="font-display font-semibold">{masked ? "••••" : fmtUsd(confirmRun.total.amount)}</span></div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Per-payout cap</span>
                <div className="w-28">
                  <Input aria-label="Per-payout cap (USDC)" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="payout-cap" />
                </div>
              </div>
            </div>
            {unpayableCount(confirmRun) > 0 ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] text-warning" data-testid="unpayable-warning">
                {unpayableCount(confirmRun)} recipient{unpayableCount(confirmRun) === 1 ? "" : "s"} {unpayableCount(confirmRun) === 1 ? "has" : "have"} no payout handle on file - those lines won't settle on-chain until they're invited.
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <ShieldCheck size={13} className="text-primary" /> Each salary stays private on-chain. Proposer ≠ approver is enforced server-side.
            </div>
          </div>
        ) : null}
      </Modal>
    </Screen>
  );
}

/** Small labelled value tile for the drawer summary. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <div className="t-label text-muted">{label}</div>
      <div className="mt-0.5 text-[14px] font-medium text-fg">{value}</div>
    </div>
  );
}

/** Collapsible section - keeps the crypto/proof detail out of the calm default view. */
function Disclosure({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid={testId}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="t-card-title text-fg">{title}</span>
        <ChevronDown size={16} className={`flex-none text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="overflow-hidden">
            <div className="border-t border-border px-4 py-3">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * "Technical details" disclosure - the three proof claims that used to crowd the
 * run row, now folded away: Funding confirmed · Approval policy satisfied · Amounts
 * calculated from rate cards. Each shows its verified-on-chain state and, when a
 * proof was captured this session, an independent re-verify drill-down.
 */
function TechnicalDetails({ batch, refs }: { batch: PayrollBatch; refs?: RunRefs }) {
  const { fundedProof: f, approvalProof: a, computationProof: c } = batch;
  const any = f || a || c;
  return (
    <Disclosure title="Technical details" testId="technical-details">
      {any ? (
        <div className="space-y-3">
          {f ? (
            <TechRow
              label="Funding confirmed"
              hint="Treasury proven to cover the run total (ORGBAL) - the total itself stays hidden."
              verified={!!f.funded && !!f.onChain}
              refData={refs?.funded}
            />
          ) : null}
          {a ? (
            <TechRow
              label="Approval policy satisfied"
              hint={`${a.approvers}-of-${a.memberCount} distinct approvers signed anonymously (ORGAUTH) - which ones stay private.`}
              verified={!!a.approved && !!a.onChain}
              refData={refs?.approval}
            />
          ) : null}
          {c ? (
            <TechRow
              label="Amounts calculated from rate cards"
              hint="Per-line amounts derived from each private rate card (PAYCOMP) - the rate card is never revealed."
              verified={!!c.ok && !!c.onChain}
              refData={refs?.computation}
            />
          ) : null}
        </div>
      ) : (
        <p className="t-secondary">Funding, approval-policy and computation proofs appear here once the run has been approved and settled on-chain.</p>
      )}
    </Disclosure>
  );
}

function TechRow({ label, hint, verified, refData }: { label: string; hint: string; verified: boolean; refData?: OnChainRef }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
          <ShieldCheck size={13} className="flex-none text-primary" /> {label}
        </div>
        <div className="t-helper mt-0.5">{hint}</div>
      </div>
      <div className="flex flex-none items-center gap-2">
        <Pill tone={verified ? "shielded" : "warning"}>{verified ? "verified on-chain" : "not verified"}</Pill>
        {refData ? <OnChainDetail refData={refData} label="View" /> : null}
      </div>
    </div>
  );
}

/**
 * Per-recipient progress inside the ceremony: each contractor "clicks done" as the
 * private proof for their salary seals. Driven from the run's b.lines register.
 * Timer-paced during the pass (like the ZK Proving strip), snapped to the real
 * per-line status once settlement confirms, and still under reduced-motion.
 */
function CeremonyRoster({
  batch,
  name,
  masked,
  phase,
  unpayable,
}: {
  batch: PayrollBatch;
  name: (id?: string) => string;
  masked: boolean;
  phase: PaymentPhase;
  unpayable: Set<string>;
}) {
  const reduce = useReducedMotion() ?? false;
  const lines = batch.lines;
  const settled = phase === "confirmed";
  const failedPhase = phase === "failed";
  const inFlight = phase === "building" || phase === "proving" || phase === "submitting";
  const proven = useProvenCount(inFlight, lines.length, reduce, settled, failedPhase);
  const doneCount = settled ? lines.filter((l) => l.status === "paid").length : proven;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.06em] text-white/50">
        <span>Recipients</span>
        <span className="text-white/70">{settled ? `${doneCount}/${lines.length} paid` : `${proven}/${lines.length} sealed`}</span>
      </div>
      <p className="mb-2.5 text-[12px] normal-case text-white/48">
        {settled ? "Salaries settled privately - amounts stay hidden on-chain." : failedPhase ? "The run stopped before every line settled." : "Proving each salary private, then funded · policy · computation on-chain."}
      </p>
      <div className="max-h-[196px] space-y-1 overflow-y-auto pr-1">
        {lines.map((l, i) => (
          <RosterRow key={i} line={l} label={name(l.counterpartyId)} masked={masked} skip={unpayable.has(l.counterpartyId)} proven={i < proven} settled={settled} failedPhase={failedPhase} animate={!reduce} />
        ))}
      </div>
    </div>
  );
}

function RosterRow({
  line,
  label,
  masked,
  skip,
  proven,
  settled,
  failedPhase,
  animate,
}: {
  line: PayrollLine;
  label: string;
  masked: boolean;
  skip: boolean;
  proven: boolean;
  settled: boolean;
  failedPhase: boolean;
  animate: boolean;
}) {
  // Resolve one of five per-row states, honestly reflecting reality once known.
  const mode: "paid" | "failed" | "skip" | "proven" | "proving" =
    settled ? (line.status === "paid" ? "paid" : line.status === "failed" ? "failed" : "skip")
    : skip ? "skip"
    : proven ? "proven"
    : "proving";
  const done = mode === "paid" || mode === "proven";
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px]">
      <span className="flex h-5 w-5 flex-none items-center justify-center">
        {done ? (
          <motion.span
            initial={animate ? { scale: 0.4, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-[#10261b]"
          >
            <Check size={12} />
          </motion.span>
        ) : mode === "failed" ? (
          <span className="h-2.5 w-2.5 rounded-full bg-danger" />
        ) : mode === "skip" ? (
          <span className="h-2.5 w-2.5 rounded-full border border-warning/70 bg-warning/30" />
        ) : (
          <motion.span
            animate={animate ? { scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] } : { opacity: 0.7 }}
            transition={{ duration: 1.1, repeat: animate ? Infinity : 0, ease: "easeInOut" }}
            className="h-2 w-2 rounded-full bg-primary"
          />
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate ${done ? "text-white/85" : "text-white/60"}`}>{label}</span>
      <span className={`flex-none text-[11.5px] ${mode === "failed" ? "text-danger" : mode === "skip" ? "text-warning" : "text-white/45"}`}>
        {mode === "paid" ? "paid" : mode === "failed" ? "failed" : mode === "skip" ? "no handle" : mode === "proven" ? "sealed" : "proving"}
      </span>
      <span className="font-display flex-none text-white/80">{masked ? "••••" : fmtUsd(line.amount)}</span>
    </div>
  );
}

/**
 * Walk 0..total while the pass is in flight so recipients seal one-by-one; snap to
 * total on a confirmed settle, freeze in place on failure, all-at-once under
 * reduced motion. Timer-paced (we have no real per-line events), matching the
 * codebase's honest Proving strip.
 */
function useProvenCount(active: boolean, total: number, reduce: boolean, complete: boolean, frozen: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (frozen) return; // failure: keep whatever sealed so far
    if (complete || reduce) {
      setN(total);
      return;
    }
    if (!active) {
      setN(0);
      return;
    }
    setN(0);
    const step = Math.max(200, Math.min(420, 1500 / Math.max(total, 1)));
    const id = setInterval(() => setN((x) => (x < total ? x + 1 : x)), step);
    return () => clearInterval(id);
  }, [active, total, reduce, complete, frozen]);
  return Math.min(n, total);
}
