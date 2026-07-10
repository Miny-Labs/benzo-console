/**
 * One-off payment — create a single confidential payment outside of payroll/invoices.
 * Pick a funding account and who you're paying; a live review summary on the right
 * fills in as you go (source, recipient, amount, fee, network, privacy, approval,
 * settlement). "Review payment" gates a send: over-threshold payments route to
 * Approvals; the rest settle privately. The payee's payout handle is resolved
 * server-side, so you never re-type it.
 */
import { useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { PaymentOrder } from "@benzo/types";
import { initialPaymentState, isInFlight, paymentReducer, type PaymentEvent } from "@benzo/ui/payment-state";
import { api } from "../lib/api";
import { useConsole } from "../lib/store";
import { fmtUsd, formatAddress, usdcToMinor } from "../lib/format";
import { NETWORK_ENV, NETWORK_LABEL } from "../lib/network";
import { Screen } from "../ui/motion";
import {
  Amount,
  Button,
  Card,
  Input,
  PageHeader,
  PrivacyDisclosure,
  Select,
  ShieldedBadge,
  StatusPill,
  useToast,
} from "../ui/primitives";
import { SendCeremony } from "../ui/SendCeremony";

/** Anything over this proposed amount routes to Approvals before it can settle. */
const APPROVAL_THRESHOLD_USD = 10_000;

export function Pay() {
  const nav = useNavigate();
  const toast = useToast();
  const { accounts, counterparties, dashboard, treasury, refresh } = useConsole();
  const live = dashboard?.live ?? false;
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [fromAccountId, setFrom] = useState("");
  const [toCounterpartyId, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [paymentState, dispatchPayment] = useReducer(paymentReducer, initialPaymentState);
  const [result, setResult] = useState<{ status: string; onChain?: boolean; unpayable?: boolean } | null>(null);

  const fromName = accounts.find((a) => a.id === fromAccountId)?.name ?? "";
  const fromBalance = treasury?.accounts.find((a) => a.account.id === fromAccountId)?.balance?.amount;
  const payee = counterparties.find((c) => c.id === toCounterpartyId);
  const hasHandle = !!payee?.paymentAddress?.shielded;
  const amountNum = Number(amount);
  const overThreshold = amountNum > APPROVAL_THRESHOLD_USD;
  const valid = !!fromAccountId && !!toCounterpartyId && amountNum > 0;
  const busy = isInFlight(paymentState);
  const ceremonyOpen = paymentState.phase !== "idle";

  // The one honest reason the primary is disabled — shown next to a neutral-gray button.
  const disabledReason = !fromAccountId
    ? "Choose the account to pay from."
    : !toCounterpartyId
      ? "Choose who you're paying."
      : amountNum <= 0
        ? "Enter an amount to pay."
        : "";

  async function submit() {
    dispatchPayment({ type: "START" });
    setResult(null);
    try {
      const po = await api.createPayment({
        type: "shielded_transfer",
        fromAccountId,
        toCounterpartyId,
        amount: { amount: usdcToMinor(amount), assetCode: "USDC" },
        memo: memo || undefined,
      });
      const settledOnChain = po.settlement?.onChain ?? false;
      const unpayable = !settledOnChain && po.status !== "needs_approval";
      setResult({ status: po.status, onChain: settledOnChain, unpayable });
      projectPaymentOrder(po, dispatchPayment, unpayable);
      toast({
        title:
          po.status === "needs_approval"
            ? "Sent for approval"
            : settledOnChain
              ? "Paid privately"
              : unpayable
                ? live
                  ? "Payment did not settle on-chain"
                  : "Live chain connection required"
                : "Payment created",
        tone: po.status === "needs_approval" || settledOnChain ? "success" : "danger",
      });
      await refresh();
    } catch (e) {
      const m = (e as Error).message;
      const friendly = /handle|balance|approv|amount|fund/i.test(m) ? m : "Couldn't send this payment. Please try again.";
      dispatchPayment({ type: "FAIL", error: friendly });
      toast({ title: friendly, tone: "danger" });
      setStep("form");
    }
  }

  function closeCeremony() {
    dispatchPayment({ type: "RESET" });
  }

  return (
    <Screen>
      <SendCeremony
        open={ceremonyOpen}
        state={paymentState}
        eyebrow="One-off payment"
        details={
          <>
            <CeremonyRow k="Pay to" v={payee?.name ?? "Selected recipient"} />
            <CeremonyRow k="Amount" v={amount ? fmtUsd(usdcToMinor(amount)) : "-"} />
            {memo ? <CeremonyRow k="Note" v={memo} /> : null}
          </>
        }
        receipt={
          result ? (
            <span>
              {result.status === "needs_approval"
                ? "Sent for approval. Funds move only after the release gate passes."
                : result.onChain
                  ? "Private settlement confirmed."
                  : "No on-chain settlement was recorded."}
            </span>
          ) : undefined
        }
        primaryAction={
          paymentState.phase === "confirmed" || paymentState.phase === "failed"
            ? { label: paymentState.phase === "confirmed" ? "Done" : "Close", onClick: closeCeremony, variant: paymentState.phase === "failed" ? "danger" : "primary" }
            : undefined
        }
        secondaryAction={
          result?.status === "needs_approval"
            ? { label: "Approvals", onClick: () => nav("/approvals"), variant: "outline" }
            : result?.unpayable
              ? { label: "Contractors", onClick: () => nav("/contractors"), variant: "outline" }
              : undefined
        }
      />

      <PageHeader
        title="One-off payment"
        subtitle="Pay a vendor or contractor privately, outside of payroll or an invoice. The amount and who you paid stay confidential."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[7fr_5fr]">
        {/* Left: the form */}
        <Card className="space-y-4">
          <div>
            <Select label="Pay from" value={fromAccountId} onChange={(e) => setFrom(e.target.value)} data-testid="pay-from">
              <option value="">Choose an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.assetCode})
                </option>
              ))}
            </Select>
            {fromAccountId ? (
              <div className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
                <span>
                  Balance:{" "}
                  {fromBalance != null ? <Amount minor={fromBalance} className="font-medium text-fg" /> : <span className="text-fg">Private</span>}
                </span>
                <ShieldedBadge label="Private" />
              </div>
            ) : null}
          </div>

          <div>
            <Select label="Pay to" value={toCounterpartyId} onChange={(e) => setTo(e.target.value)} data-testid="pay-to">
              <option value="">Choose who you're paying…</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {payee ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                {payee.status ? <StatusPill status={payee.status} /> : null}
                {hasHandle ? (
                  <span>Payout handle on file — eligible to receive.</span>
                ) : (
                  <span className="text-warning">No payout handle yet — may not settle until onboarded.</span>
                )}
              </div>
            ) : null}
          </div>

          <Input
            label="Amount"
            hint="In USDC"
            placeholder="0.00"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            data-testid="pay-amount"
          />
          <Input
            label="Note (optional)"
            hint="Internal reference — visible to authorized workspace members, not on-chain."
            placeholder="PO-4480 components"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />

          {step === "form" ? (
            <div className="space-y-2 pt-1">
              <Button className="w-full" size="lg" disabled={!valid} onClick={() => setStep("confirm")} data-testid="pay-review">
                Review payment
              </Button>
              {!valid ? <p className="text-center text-[12px] text-muted">{disabledReason}</p> : null}
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" size="lg" onClick={() => setStep("form")} disabled={busy}>
                Back
              </Button>
              <Button className="flex-1" size="lg" disabled={busy} onClick={submit} data-testid="pay-submit">
                <ArrowUpRight size={16} /> Send {fmtUsd(usdcToMinor(amount))} privately
              </Button>
            </div>
          )}

          {result ? (
            <div
              className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-[13px] ${
                result.unpayable ? "border-danger/30 bg-danger/8 text-danger" : "border-success/30 bg-success/8 text-success"
              }`}
              data-testid="pay-result"
            >
              <span>
                {result.status === "needs_approval"
                  ? "Sent for approval (over your limit)."
                  : result.onChain
                    ? "Paid privately. All done."
                    : result.unpayable
                      ? "This payment did not settle on-chain. Check the recipient handle and treasury balance, then try again."
                      : "Payment created."}
              </span>
              {result.status === "needs_approval" ? (
                <button onClick={() => nav("/approvals")} className="inline-flex flex-none items-center gap-1 font-semibold text-primary hover:underline">
                  Approvals <ArrowRight size={13} />
                </button>
              ) : result.unpayable ? (
                <button onClick={() => nav("/contractors")} className="inline-flex flex-none items-center gap-1 font-semibold text-primary hover:underline">
                  Contractors <ArrowRight size={13} />
                </button>
              ) : null}
            </div>
          ) : null}
        </Card>

        {/* Right: the live review summary */}
        <div className="space-y-4">
          <Card compact>
            <div className="t-card-title text-fg">Review</div>
            <p className="t-helper mt-0.5">Updates as you fill in the payment.</p>
            <dl className="mt-3 divide-y divide-border text-sm">
              <SummaryRow label="Source" value={fromName || placeholder} />
              <SummaryRow
                label="Recipient"
                value={
                  payee ? (
                    <span className="inline-flex flex-col items-end gap-0.5">
                      <span className="font-medium text-fg">{payee.name}</span>
                      {payee.paymentAddress?.shielded ? (
                        <span className="font-mono text-[11px] text-muted">{formatAddress(payee.paymentAddress.shielded, 6, 6)}</span>
                      ) : null}
                    </span>
                  ) : (
                    placeholder
                  )
                }
              />
              <SummaryRow
                label="Amount"
                value={amountNum > 0 ? <Amount minor={usdcToMinor(amount)} code="USDC" /> : placeholder}
              />
              <SummaryRow label="Network fee" value={<span className="text-success">Free</span>} />
              <SummaryRow label="Network" value={NETWORK_ENV.chip} />
              <SummaryRow label="Privacy" value="Private on-chain — amount and recipient hidden" />
              <SummaryRow
                label="Approval"
                value={
                  amountNum > 0
                    ? overThreshold
                      ? "Routes to Approvals (over your limit)"
                      : "Sends after you review"
                    : placeholder
                }
              />
              <SummaryRow label="Settlement" value={`Settles on ${NETWORK_LABEL} in seconds`} />
            </dl>
          </Card>

          <PrivacyDisclosure hidden={["Amount", "Who you paid"]} proven={["You're an approved sender", "Funds verified clean"]} />
        </div>
      </div>
    </Screen>
  );
}

const placeholder = <span className="text-muted">—</span>;

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="flex-none text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-fg">{value}</dd>
    </div>
  );
}

function CeremonyRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex-none text-white/48">{k}</span>
      <span className="min-w-0 truncate text-right font-semibold text-white">{v}</span>
    </div>
  );
}

function projectPaymentOrder(po: PaymentOrder, dispatch: (event: PaymentEvent) => void, unpayable: boolean) {
  if (po.status === "needs_approval") {
    dispatch({ type: "RESET" });
    return;
  }
  if (unpayable || po.status === "failed") {
    dispatch({ type: "FAIL", error: "Payment did not settle on-chain." });
    return;
  }

  dispatch({ type: "WITNESS_READY" });
  dispatch({ type: "PROOF_READY" });
  dispatch({ type: "SUBMITTED", txHash: po.settlement?.txHash ?? "" });
  dispatch({ type: "CONFIRMED", result: po });
}
