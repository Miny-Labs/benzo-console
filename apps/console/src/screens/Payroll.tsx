/**
 * Payroll - confidential batch runs. Each batch hides individual salaries on-chain
 * (one shielded transfer per person) while the employer can still prove the total.
 *
 * "Approve & run" is ONE animated pass: it proves funded (ORGBAL) + policy
 * (SPENDCAP/screen) + computation (PAYCOMP) + anonymous approval (ORGAUTH) and
 * settles the batch, shown through the shared full-screen send ceremony with
 * per-recipient progress. No standalone proof buttons on the happy path. Run
 * creation lives here too (New run pulls the allowlisted roster), so Payroll is
 * self-contained.
 */
import { useEffect, useReducer, useState } from "react";
import { Check, CheckCheck, Download, Plus, ReceiptText, ShieldCheck, Users } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import type { PayrollBatch, PayrollLine } from "@benzo/types";
import { initialPaymentState, type PaymentPhase, paymentReducer } from "@benzo/ui/payment-state";
import { api, type OnChainRef } from "../lib/api";
import { useConsole, useCounterpartyName } from "../lib/store";
import { explorerTxUrl, fmtUsd, friendlyError } from "../lib/format";
import { Screen, Stagger, motion, spring } from "../ui/motion";
import { OnChainDetail } from "../ui/onchain";
import { SendCeremony } from "../ui/SendCeremony";
import { Button, Card, EmptyState, Input, Modal, Pill, Skeleton, StatusPill, useToast } from "../ui/primitives";

/** On-chain refs captured from the automated pass, per proof, for the receipt drill-down. */
type RunRefs = { funded?: OnChainRef; approval?: OnChainRef; computation?: OnChainRef };
/** What actually settled, surfaced in the ceremony receipt. */
type RunOutcome = { total: number; paid: number; failed: number; onChain: boolean; txHash?: string };

const period = () => new Date().toISOString().slice(0, 7); // e.g. 2026-06

export function Payroll() {
  const toast = useToast();
  const { payrolls, counterparties, masked, refresh, loading } = useConsole();
  const name = useCounterpartyName();
  // Count recipients with no on-chain payout material on file - those lines can't
  // settle privately, so the approver sees it BEFORE an irreversible run, not after.
  const unpayableIds = (b: PayrollBatch) =>
    new Set(b.lines.filter((l) => !counterparties.find((c) => c.id === l.counterpartyId)?.paymentAddress?.shielded).map((l) => l.counterpartyId));
  const unpayableCount = (b: PayrollBatch) => unpayableIds(b).size;
  const hasFailedLines = (b: PayrollBatch) => b.lines.some((l) => l.status === "failed");
  const visiblePayrolls = [...payrolls].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  // Allowlisted contractors with a rate card = the roster a New run pulls from.
  const payableContractors = counterparties.filter((c) => c.type === "contractor" && c.payRate && c.status === "allowlisted");

  const [cap, setCap] = useState("5000.00");
  const [creating, setCreating] = useState(false);
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
      const [funded, , computation] = await Promise.all([
        api.proveFunded(b.id),
        api.provePolicy(b.id, cap),
        api.proveComputation(b.id),
      ]);
      if (funded.ref) captured.funded = funded.ref;
      if (computation.ref) captured.computation = computation.ref;

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

      dispatchPayment({ type: "PROOF_READY" }); // submitting N transfers
      const settledTx = approved.lines.find((l) => l.txHash)?.txHash ?? "";
      dispatchPayment({ type: "SUBMITTED", txHash: settledTx });

      const failed = approved.lines.filter((l) => l.status === "failed").length;
      const paid = approved.lines.filter((l) => l.status === "paid").length;
      const onChain = approved.lines.some((l) => l.onChain);
      setRunOutcome({ total: approved.lines.length, paid, failed, onChain, txHash: settledTx || undefined });

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
      toast({ title: `${period()} run drafted · ${batch.lines.length} contractor${batch.lines.length === 1 ? "" : "s"} · ${fmtUsd(batch.total.amount)}`, tone: "success" });
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setCreating(false);
    }
  }

  const approvedCount = (b: PayrollBatch) => (b.approvals ?? []).filter((a) => a.decision === "approved").length;

  function download(name: string, text: string, type: string) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
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
        eyebrow={ceremonyBatch ? `${ceremonyBatch.period} payroll run` : "Payroll run"}
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

      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Payroll</h1>
          <p className="mt-1 text-[13.5px] text-muted">Salaries private on-chain · total provable to an auditor</p>
        </div>
        <Button onClick={createRun} loading={creating} disabled={payableContractors.length === 0} data-testid="new-run">
          <Plus size={15} /> New run
        </Button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Card key={i} className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-7 w-24" />
              </div>
            </Card>
          ))}
        </div>
      ) : payrolls.length === 0 ? (
        <EmptyState
          title="No payroll runs yet"
          hint={payableContractors.length ? `New run pulls your ${payableContractors.length} allowlisted contractor${payableContractors.length === 1 ? "" : "s"} - amounts are computed from their rate cards.` : "Add allowlisted contractors with rate cards, then start a run here."}
        />
      ) : (
        <Stagger className="space-y-4">
          {visiblePayrolls.map((b, i) => {
            const proofRefs = refs[b.id];
            const runnable = b.status === "needs_approval" || b.status === "approved" || b.status === "processing";
            return (
              <Stagger.Item key={b.id} index={i}>
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Users size={20} />
                      </div>
                      <div>
                        <div className="text-[15px] font-semibold">{b.period} payroll</div>
                        <div className="text-[13px] text-muted">
                          {b.lines.length} {b.lines.length === 1 ? "person" : "people"} · via {b.source}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-display tnum text-xl font-semibold text-fg" data-testid="payroll-total">{masked ? "••••" : fmtUsd(b.total.amount)}</div>
                        <div className="mt-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
                          {/* Proof pills go green (shielded) ONLY when the proof actually verified on-chain. */}
                          {b.fundedProof ? (
                            <span className="inline-flex items-center gap-1" data-testid="funded-badge">
                              <Pill tone={!b.fundedProof.funded ? "danger" : b.fundedProof.onChain ? "shielded" : "warning"}>
                                <ShieldCheck size={11} /> {b.fundedProof.funded ? (b.fundedProof.onChain ? "Funded on-chain" : "Funding not verified on-chain") : "Over budget"}
                              </Pill>
                              {proofRefs?.funded ? <OnChainDetail refData={proofRefs.funded} label="" /> : null}
                            </span>
                          ) : null}
                          {b.approvalProof ? (
                            <span className="inline-flex items-center gap-1" data-testid="approval-badge">
                              <Pill tone={!b.approvalProof.approved ? "danger" : b.approvalProof.onChain ? "shielded" : "warning"}>
                                <ShieldCheck size={11} /> {b.approvalProof.approved ? `Approved ${b.approvalProof.approvers}-of-${b.approvalProof.memberCount} · anonymous${b.approvalProof.onChain ? "" : " · not verified on-chain"}` : "Not approved"}
                              </Pill>
                              {proofRefs?.approval ? <OnChainDetail refData={proofRefs.approval} label="" /> : null}
                            </span>
                          ) : null}
                          {b.computationProof ? (
                            <span className="inline-flex items-center gap-1" data-testid="computation-badge">
                              <Pill tone={!b.computationProof.ok ? "danger" : b.computationProof.onChain ? "shielded" : "warning"}>
                                <ShieldCheck size={11} /> {b.computationProof.ok ? (b.computationProof.onChain ? "Computed from rate card" : "Computation not verified on-chain") : "Computation unverified"}
                              </Pill>
                              {proofRefs?.computation ? <OnChainDetail refData={proofRefs.computation} label="" /> : null}
                            </span>
                          ) : null}
                          {b.status === "needs_approval" && approvedCount(b) > 0 ? (
                            <span className="text-[11px] font-semibold text-[#9a6b12]">{approvedCount(b)} approved · needs more</span>
                          ) : null}
                          {b.status === "processing" && hasFailedLines(b) ? (
                            <Pill tone="danger">failed payouts</Pill>
                          ) : (
                            <StatusPill status={b.status} />
                          )}
                        </div>
                      </div>
                      {runnable ? (
                        <Button onClick={() => setConfirmRun(b)} data-testid="run-payroll">
                          <CheckCheck size={15} /> {b.status === "processing" ? "Retry failed" : "Approve & run"}
                        </Button>
                      ) : (
                        <Button variant="ghost" onClick={() => setOpen(open === b.id ? null : b.id)}>
                          {open === b.id ? "Hide" : "Details"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {runnable ? (
                    <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-[12.5px] text-muted" data-testid="run-hint">
                      <ShieldCheck size={14} className="flex-none text-primary" />
                      <span>
                        <span className="font-semibold text-fg">Approve &amp; run</span> proves funded, policy, computation and anonymous approval, then settles - all in one pass.
                      </span>
                      {b.status === "processing" && hasFailedLines(b) ? (
                        <span className="ml-auto font-semibold text-danger" data-testid="payroll-failed-note">This run did not settle. Retry to re-attempt the failed lines.</span>
                      ) : null}
                    </div>
                  ) : null}

                  {open === b.id ? (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 overflow-hidden border-t border-border pt-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">Run register</span>
                        <div className="flex items-center gap-4">
                          <button onClick={() => downloadPayslips(b)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline" data-testid="download-payslips">
                            <Download size={13} /> Payslips
                          </button>
                          <button onClick={() => exportCsv(b)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline" data-testid="export-csv">
                            <Download size={13} /> Export CSV
                          </button>
                        </div>
                      </div>
                      {b.lines.map((l, li) => (
                        <div key={li} className="flex items-center gap-3 py-2 text-[13.5px]">
                          <span className="w-40 truncate">{name(l.counterpartyId)}</span>
                          <span className="flex-1 text-[12px] text-danger">{l.status === "failed" && l.error ? l.error : ""}</span>
                          {l.capProof ? (
                            <Pill tone={!l.capProof.onChain ? "warning" : !l.capProof.withinCap ? "danger" : "shielded"}>
                              <ShieldCheck size={10} /> {!l.capProof.onChain ? "cap not verified on-chain" : l.capProof.withinCap ? "within cap" : "over cap"}
                            </Pill>
                          ) : null}
                          {l.screenProof ? (
                            <Pill tone={!l.screenProof.onChain ? "warning" : !l.screenProof.innocent ? "danger" : "shielded"}>
                              <ShieldCheck size={10} /> {!l.screenProof.onChain ? "screening not verified on-chain" : l.screenProof.innocent ? "not sanctioned" : "sanctioned"}
                            </Pill>
                          ) : null}
                          {l.txHash ? (
                            <a href={explorerTxUrl(l.txHash)} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-primary hover:underline">receipt</a>
                          ) : null}
                          {l.status === "paid" && !l.onChain ? (
                            <Pill tone="warning">not settled on-chain</Pill>
                          ) : (
                            <Pill tone={l.status === "paid" ? "success" : l.status === "failed" ? "danger" : "warning"}>{l.status}</Pill>
                          )}
                          <span className="font-display tnum w-24 text-right font-semibold text-fg">{masked ? "••••" : fmtUsd(l.amount)}</span>
                        </div>
                      ))}
                    </motion.div>
                  ) : null}
                </Card>
              </Stagger.Item>
            );
          })}
        </Stagger>
      )}

      <Modal
        open={!!confirmRun}
        onClose={() => setConfirmRun(null)}
        title={confirmRun?.status === "processing" ? "Retry failed payouts" : "Approve & run this payroll"}
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
              <CheckCheck size={15} /> {confirmRun?.status === "processing" ? "Retry failed" : "Approve & run"}
            </Button>
          </>
        }
      >
        {confirmRun ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              This is your approval step for the <b>{confirmRun.period}</b> run. If it's the final required step, it proves funded, policy, computation and approval, then settles real on-chain payouts and <b>can't be undone</b>.
            </p>
            <div className="space-y-2 rounded-xl bg-canvas p-4 text-[14px]">
              <div className="flex justify-between"><span className="text-muted">Recipients</span><span className="font-semibold">{confirmRun.lines.length}</span></div>
              <div className="flex justify-between"><span className="text-muted">Total</span><span className="font-display tnum font-semibold">{masked ? "••••" : fmtUsd(confirmRun.total.amount)}</span></div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Per-payout cap</span>
                <div className="w-28">
                  <Input aria-label="Per-payout cap (USDC)" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="payout-cap" />
                </div>
              </div>
            </div>
            {unpayableCount(confirmRun) > 0 ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] text-[#9a6b12]" data-testid="unpayable-warning">
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
        <span className="tnum text-white/70">{settled ? `${doneCount}/${lines.length} paid` : `${proven}/${lines.length} sealed`}</span>
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
      <span className="font-display tnum flex-none text-white/80">{masked ? "••••" : fmtUsd(line.amount)}</span>
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
