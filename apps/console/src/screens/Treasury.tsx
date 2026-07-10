/**
 * Treasury - the org's two USDC balances and the prove actions.
 *
 * Two-balance model (same plain vocab as the wallet, never "shielded"):
 *   • Private - the M-of-N shielded pool (api.treasury). Only you can see it,
 *     paid privately Benzo-to-Benzo, provable on demand without revealing it.
 *   • Public - plain liquid USDC at the org's own address. This is what any
 *     external wallet or exchange sends to and receives from.
 * Convert: "Make private" (Public -> pool / shield = api.fundTreasury) plays a
 * full-screen shield cinematic (the shared SendCeremony, payment-state driven).
 * There's no "Make public" for the org treasury (M-of-N notes have no direct
 * pool -> public unshield), so it isn't offered. Send to a wallet is a real
 * on-chain USDC payment from Public; Receive shows the address + QR.
 *
 * Prove to an auditor: the former three prove cards (reserves / exact total /
 * solvency) collapse into ONE surface - pick what to disclose, then a shared
 * "proving -> verified on-chain" reveal flips the Merkle root into view. Each is
 * still a real Groth16 proof verified on-chain, every result carries an on-chain
 * reference you can re-verify.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Eye, EyeOff, QrCode as QrIcon, Send, ShieldCheck, Wallet } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { initialPaymentState, isInFlight, paymentReducer } from "@benzo/ui/payment-state";
import { api, type OnChainRef } from "../lib/api";
import { useConsole } from "../lib/store";
import { explorerTxUrl, fmtUsd, formatAddress, friendlyError, usdcToMinor } from "../lib/format";
import { NETWORK_LABEL } from "../lib/network";
import { EASE, motion, Screen, Reveal, Stagger } from "../ui/motion";
import { OnChainDetail } from "../ui/onchain";
import { SendCeremony } from "../ui/SendCeremony";
import { QrCode } from "../ui/qr";
import { AddressDisplay, Button, Card, CopyButton, Input, Modal, Pill, Skeleton, useToast } from "../ui/primitives";

/** The three things a treasury can prove to an auditor — one surface, one ceremony. */
type Disclosure = "reserves" | "total" | "solvency";
const DISCLOSURES: Array<{ id: Disclosure; title: string; blurb: string }> = [
  { id: "reserves", title: "Reserves clear a floor", blurb: "Prove the treasury holds at least a chosen amount. The real figure stays private." },
  { id: "total", title: "Exact total", blurb: "Disclose the precise sum of your shielded notes. Individual amounts stay hidden." },
  { id: "solvency", title: "Solvent (assets ≥ liabilities)", blurb: "Prove the treasury covers pending payroll + open invoices. Both stay hidden." },
];

/** What the shared ceremony needs to render the auditor reveal + on-chain receipt. */
interface ProveResult {
  headline: string;
  onChain: boolean;
  ref?: OnChainRef;
}

export function Treasury() {
  const toast = useToast();
  const { treasury, masked, loading, refresh } = useConsole();

  // ---- Public balance + receive coordinates (two-balance model) -------------
  const [pub, setPub] = useState<{ units: string; address: string; asset: string; issuer: string; live: boolean } | null>(null);
  const [pubLoading, setPubLoading] = useState(true);

  async function loadPublic() {
    try {
      setPub(await api.treasuryPublicBalance());
    } catch {
      /* leave prior value; the public card shows a calm "-" */
    } finally {
      setPubLoading(false);
    }
  }
  useEffect(() => {
    void loadPublic();
  }, []);

  const reduce = useReducedMotion() ?? false;

  // ---- Make private (Fund / shield): Public -> pool -------------------------
  // Full-screen shield cinematic: the shared payment-state ceremony walks
  // encrypt -> settle -> verify (with floors) and ends on the on-chain receipt.
  const [fundAmt, setFundAmt] = useState("0.20");
  const [confirmFund, setConfirmFund] = useState(false);
  const [fundState, dispatchFund] = useReducer(paymentReducer, initialPaymentState);
  const busyFund = isInFlight(fundState);

  async function fund() {
    dispatchFund({ type: "START" });
    let confirmed = false;
    try {
      const r = await api.fundTreasury(fundAmt);
      if (r.onChain) {
        // Walk the ceremony honestly: the flooring still plays the Settling beat.
        dispatchFund({ type: "WITNESS_READY" });
        dispatchFund({ type: "PROOF_READY" });
        dispatchFund({ type: "SUBMITTED", txHash: r.txHash ?? "" });
        dispatchFund({ type: "CONFIRMED", result: r });
        toast({ title: `Made private · ${fundAmt} USDC`, tone: "success" });
        confirmed = true;
      } else {
        dispatchFund({ type: "FAIL", error: r.error ?? "Couldn't move to Private on-chain" });
        toast({ title: r.error ?? "Couldn't move to Private on-chain", tone: "danger" });
      }
    } catch (e) {
      dispatchFund({ type: "FAIL", error: friendlyError(e) });
      toast({ title: friendlyError(e), tone: "danger" });
    }
    // Refresh the balances OUTSIDE the try above: the shield already settled and
    // its confirmed receipt is showing, so a transient refresh error must never
    // dispatch FAIL and flip a genuinely-confirmed ceremony to a failed state.
    if (confirmed) {
      await Promise.all([refresh(), loadPublic()]).catch(() => {});
    }
  }

  // Note: there is no "Make public" for the org treasury - it's held as M-of-N
  // notes with no direct pool -> public unshield path, so we don't offer it.

  // ---- Send to a wallet (real public on-chain USDC payment) -----------------
  const [sendTo, setSendTo] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [sendResult, setSendResult] = useState<{ onChain: boolean; txHash?: string; error?: string } | null>(null);
  const addrLooksValid = /^0x[a-fA-F0-9]{40}$/.test(sendTo.trim());

  async function sendPublic(): Promise<boolean> {
    setBusySend(true);
    setSendResult(null);
    try {
      const r = await api.treasurySendPublic(sendTo.trim(), sendAmt);
      if (r.onChain) {
        setSendResult({ onChain: true, txHash: r.txHash });
        toast({ title: `Sent ${sendAmt} USDC to a wallet`, tone: "success" });
        setSendTo("");
        setSendAmt("");
        await loadPublic();
        return true;
      } else {
        setSendResult({ onChain: false, error: r.error });
        toast({ title: r.error ?? "Couldn't send", tone: "danger" });
        return false;
      }
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
      setSendResult({ onChain: false, error: friendlyError(e) });
      return false;
    } finally {
      setBusySend(false);
    }
  }

  // ---- Receive (address + QR) ----------------------------------------------
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [recv, setRecv] = useState<{ address: string; asset: string; issuer: string; live: boolean } | null>(null);
  const [recvLoading, setRecvLoading] = useState(false);

  async function openReceive() {
    setReceiveOpen(true);
    if (recv?.address) return;
    setRecvLoading(true);
    try {
      setRecv(await api.treasuryReceive());
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setRecvLoading(false);
    }
  }

  // ---- Prove to an auditor (one surface, pick what to disclose) -------------
  // The three former prove cards (reserves / exact total / solvency) collapse
  // into a single action sharing one "proving -> verified on-chain" ceremony.
  const [min, setMin] = useState("100000");
  const [disclose, setDisclose] = useState<Disclosure>("reserves");
  const [proveState, dispatchProve] = useReducer(paymentReducer, initialPaymentState);
  const [proveResult, setProveResult] = useState<ProveResult | null>(null);
  const busyProve = isInFlight(proveState);
  const activeDisclosure = DISCLOSURES.find((d) => d.id === disclose) ?? DISCLOSURES[0];

  // Full ARIA radiogroup nav for the disclosure picker: roving tabIndex (single
  // tab stop) + arrow keys move selection and focus between the options.
  const discloseRefs = useRef<Array<HTMLButtonElement | null>>([]);
  function onDiscloseKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (index + 1) % DISCLOSURES.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (index - 1 + DISCLOSURES.length) % DISCLOSURES.length;
    else return;
    e.preventDefault();
    setDisclose(DISCLOSURES[next].id);
    discloseRefs.current[next]?.focus();
  }

  async function runProof() {
    dispatchProve({ type: "START" });
    setProveResult(null);
    try {
      let headline: string;
      let onChain: boolean;
      let ref: OnChainRef | undefined;
      let ok: boolean;
      if (disclose === "reserves") {
        const minUnits = usdcToMinor(min);
        const r = await api.proveBalance(minUnits);
        onChain = r.onChain;
        ok = r.holds;
        ref = r.ref ? { ...r.ref, label: "Reserves proof" } : undefined;
        headline = r.holds ? `Holds ≥ ${fmtUsd(minUnits)}` : "Below the requested floor";
      } else if (disclose === "total") {
        const r = await api.proveTotal();
        onChain = r.onChain;
        ok = r.onChain;
        ref = r.ref ? { ...r.ref, label: "Period total proof" } : undefined;
        headline = `Total: ${fmtUsd(r.total)}`;
      } else {
        const r = await api.proveSolvency();
        onChain = r.onChain;
        ok = r.solvent;
        ref = r.ref ? { ...r.ref, label: "Solvency proof" } : undefined;
        headline = r.solvent ? "Solvent — assets cover all liabilities" : "Not solvent — liabilities exceed treasury";
      }
      setProveResult({ headline, onChain, ref });
      if (onChain) {
        // The proof cleared the on-chain verifier: play the verified reveal
        // (which flips the Merkle root into view). The verdict lives in `headline`.
        dispatchProve({ type: "WITNESS_READY" });
        dispatchProve({ type: "PROOF_READY" });
        dispatchProve({ type: "SUBMITTED", txHash: ref?.txHash ?? "" });
        dispatchProve({ type: "CONFIRMED", result: ref });
        toast({ title: ok ? `${headline} · verified on-chain` : `${headline} · proven on-chain`, tone: "success" });
      } else {
        dispatchProve({ type: "FAIL", error: "Proof was not verified on-chain" });
        toast({ title: "Proof was not verified on-chain", tone: "danger" });
      }
    } catch (e) {
      dispatchProve({ type: "FAIL", error: friendlyError(e) });
      toast({ title: friendlyError(e), tone: "danger" });
    }
  }

  const publicUsd = pub ? fmtUsd(pub.units) : "$0.00";

  return (
    <Screen>
      {/* Make private: full-screen shield cinematic (coin -> encrypted pool). */}
      <SendCeremony
        open={fundState.phase !== "idle"}
        state={fundState}
        eyebrow="Make private"
        details={
          <>
            <CeremonyRow k="Amount" v={fmtUsd(usdcToMinor(fundAmt))} />
            <CeremonyRow k="From" v="Public" />
            <CeremonyRow k="Into" v="Private pool (M-of-N note)" />
          </>
        }
        receipt={fundState.phase === "confirmed" ? <FundReceipt txHash={fundState.txHash} /> : undefined}
        primaryAction={
          fundState.phase === "confirmed" || fundState.phase === "failed"
            ? {
                label: fundState.phase === "confirmed" ? "Done" : "Close",
                onClick: () => dispatchFund({ type: "RESET" }),
                variant: fundState.phase === "failed" ? "danger" : "primary",
              }
            : undefined
        }
      />

      {/* Prove to an auditor: shared "proving -> verified on-chain" reveal. */}
      <SendCeremony
        open={proveState.phase !== "idle"}
        state={proveState}
        eyebrow="Prove to an auditor"
        details={
          <>
            <CeremonyRow k="Disclosing" v={activeDisclosure.title} />
            {disclose === "reserves" ? <CeremonyRow k="Floor" v={fmtUsd(usdcToMinor(min))} /> : null}
          </>
        }
        receipt={proveState.phase === "confirmed" && proveResult ? <ProveReceipt result={proveResult} reduce={reduce} /> : undefined}
        primaryAction={
          proveState.phase === "confirmed" || proveState.phase === "failed"
            ? {
                label: proveState.phase === "confirmed" ? "Done" : "Close",
                onClick: () => dispatchProve({ type: "RESET" }),
                variant: proveState.phase === "failed" ? "danger" : "primary",
              }
            : undefined
        }
      />

      <div className="mb-5">
        <h1 className="font-display text-2xl">Treasury</h1>
        <p className="mt-1 text-[13.5px] text-muted">Two balances · Private stays hidden and provable · Public sends to and receives from any wallet</p>
      </div>

      {/* ---- Two-balance header: Private (shielded) + Public ----------------- */}
      <div className="mb-4 grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
        {/* Private (shielded) - the main shielded position */}
        <Card className="flex flex-col p-5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
            Private (shielded)
            <Pill tone="shielded">
              <ShieldCheck size={12} /> Provable on demand
            </Pill>
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-10 w-56" />
          ) : (
            <div className="font-display tnum mt-2 text-[40px] leading-none" data-testid="treasury-total">
              {masked ? "••••••" : fmtUsd(treasury?.totalHidden.amount ?? "0")}
            </div>
          )}
          <div className="mt-auto pt-2 text-[12.5px] text-muted">Only you can see this · sent privately to a Benzo @handle</div>
        </Card>

        {/* Public - plain liquid USDC any wallet/exchange sees */}
        <Card className="flex flex-col p-5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
            Public
            <Pill tone="muted">
              <Eye size={12} /> Visible on-chain
            </Pill>
          </div>
          {pubLoading && !pub ? (
            <Skeleton className="mt-2 h-10 w-56" />
          ) : (
            <div className="font-display tnum mt-2 text-[40px] leading-none text-[#2c3744]" data-testid="public-balance">
              {masked ? "••••••" : publicUsd}
            </div>
          )}
          <div className="mt-auto pt-2 text-[12.5px] text-muted">Normal USDC. Send to or receive from any wallet or exchange.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="md" onClick={() => void openReceive()} data-testid="receive-open">
              <ArrowDownToLine size={15} /> Receive
            </Button>
            <Button variant="outline" size="md" onClick={() => setConfirmSend(true)} disabled={!pub?.live} title={pub?.live ? undefined : "Connect to a live network to send"} data-testid="send-wallet-open">
              <Send size={15} /> Send to a wallet
            </Button>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* left: convert actions + accounts */}
        <div className="space-y-4">
          {/* Make private: Public -> shielded pool. (Make public isn't offered - the org
              treasury is M-of-N and has no direct pool -> public unshield path.) */}
          <div className="grid grid-cols-1 gap-4">
            {/* Make private (shield) - was "Fund treasury" */}
            <Card className="flex flex-col p-5">
              <div className="flex items-center gap-2 text-[14px] font-semibold">
                <EyeOff size={16} className="text-shielded" /> Make private
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                Move USDC from Public into the private pool. It lands as an M-of-N org note - dual-controlled the moment it arrives.
              </p>
              <div className="mt-4">
                <Input
                  label="Amount (USDC)"
                  inputMode="decimal"
                  value={fundAmt}
                  onChange={(e) => setFundAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                  data-testid="fund-amount"
                />
              </div>
              <Button className="mt-4 w-full" onClick={() => setConfirmFund(true)} disabled={busyFund || !(Number(fundAmt) > 0)} data-testid="fund-treasury">Make private</Button>
            </Card>
          </div>

          {/* Accounts inside the private pool */}
          {loading && !treasury ? (
            <div className="space-y-4">
              {[0, 1].map((i) => (
                <Card key={i} className="flex items-center gap-3 p-4">
                  <Skeleton className="h-11 w-11 flex-none rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                </Card>
              ))}
            </div>
          ) : (treasury?.accounts ?? []).length === 0 ? (
            <Card className="p-8 text-center text-[13px] text-muted">No accounts connected yet.</Card>
          ) : (
            <Stagger className="space-y-4">
              {(treasury?.accounts ?? []).map((a, i) => (
                <Stagger.Item key={a.account.id} index={i}>
                  <Card className="flex items-center gap-3 p-4">
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Wallet size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-semibold">{a.account.name}</div>
                      <div className="truncate text-[12.5px] capitalize text-muted">{a.account.type} · {a.account.assetCode}</div>
                    </div>
                    <div className="font-display tnum flex-none text-lg text-[#2c3744]">
                      {a.balance ? (masked ? "••••" : fmtUsd(a.balance.amount)) : <span className="mask">private</span>}
                    </div>
                  </Card>
                </Stagger.Item>
              ))}
            </Stagger>
          )}
        </div>

        {/* right: one auditor-disclosure surface (was three prove cards) */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <ShieldCheck size={16} className="text-primary" /> Prove to an auditor
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Pick what to disclose. Benzo builds a real Groth16 proof and verifies it on-chain - the underlying balances stay private, and every result folds to a Merkle root anyone can re-check.
            </p>

            <div className="mt-4 grid gap-2" role="radiogroup" aria-label="What to disclose">
              {DISCLOSURES.map((d, index) => {
                const selected = disclose === d.id;
                return (
                  <button
                    key={d.id}
                    ref={(el) => {
                      discloseRefs.current[index] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setDisclose(d.id)}
                    onKeyDown={(e) => onDiscloseKeyDown(e, index)}
                    disabled={busyProve}
                    data-testid={`disclose-${d.id}`}
                    className={`rounded-xl border px-3.5 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 ${
                      selected ? "border-primary/50 bg-primary/[0.06]" : "border-border hover:border-primary/30 hover:bg-border/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[13.5px] font-semibold ${selected ? "text-primary" : "text-fg"}`}>{d.title}</span>
                      <span className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border ${selected ? "border-primary" : "border-border"}`}>
                        {selected ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-muted">{d.blurb}</div>
                  </button>
                );
              })}
            </div>

            {disclose === "reserves" ? (
              <div className="mt-3">
                <Input label="Prove we hold at least (USDC)" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="prove-min" />
              </div>
            ) : null}

            <Button
              className="mt-4 w-full"
              onClick={runProof}
              disabled={busyProve || (disclose === "reserves" && !(Number(min) > 0))}
              data-testid="prove-auditor"
            >
              <ShieldCheck size={15} /> Prove to auditor
            </Button>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              Every proof is verified by the on-chain verifier - nothing here is asserted on trust.
            </p>
          </Card>
        </div>
      </div>

      {/* ---- Make private confirm modal ------------------------------------- */}
      <Modal
        open={confirmFund}
        onClose={() => setConfirmFund(false)}
        title="Make private"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmFund(false)}>Cancel</Button>
            <Button loading={busyFund} onClick={() => { setConfirmFund(false); void fund(); }} data-testid="fund-confirm">
              <EyeOff size={15} /> Make {fmtUsd(usdcToMinor(fundAmt))} private
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            This moves <b>real USDC</b> on {NETWORK_LABEL} from your Public balance into the private pool - a dual-controlled M-of-N org note. It settles on-chain and <b>can't be undone</b> from here.
          </p>
          <p className="text-[12.5px] leading-relaxed text-muted">
            Proof location: local. The Console prover creates the shield proof in the Benzo runtime before the on-chain settlement is accepted.
          </p>
          <div className="space-y-2 rounded-xl bg-canvas p-4 text-[14px]">
            <div className="flex justify-between"><span className="text-muted">Amount</span><span className="font-display tnum font-semibold">{fmtUsd(usdcToMinor(fundAmt))}</span></div>
            <div className="flex justify-between"><span className="text-muted">From</span><span className="font-semibold">Public</span></div>
            <div className="flex justify-between"><span className="text-muted">Into</span><span className="font-semibold">Private (M-of-N note)</span></div>
            <div className="flex justify-between"><span className="text-muted">Proof location</span><span className="font-semibold">Local</span></div>
          </div>
        </div>
      </Modal>

      {/* ---- Send to a wallet confirm modal --------------------------------- */}
      <Modal
        open={confirmSend}
        onClose={() => { if (!busySend) setConfirmSend(false); }}
        title="Send to a wallet"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSend(false)} disabled={busySend}>Cancel</Button>
            <Button
              loading={busySend}
              disabled={!addrLooksValid || !(Number(sendAmt) > 0)}
              onClick={() => {
                void sendPublic().then((ok) => {
                  if (ok) setConfirmSend(false);
                });
              }}
              data-testid="send-wallet-confirm"
            >
              <Send size={15} /> Send {Number(sendAmt) > 0 ? fmtUsd(usdcToMinor(sendAmt)) : "USDC"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Recipient wallet address"
            placeholder="0x..."
            spellCheck={false}
            value={sendTo}
            onChange={(e) => {
              setSendResult(null);
              setSendTo(e.target.value.trim());
            }}
            error={sendTo.length > 0 && !addrLooksValid ? "That doesn't look like a valid wallet address." : undefined}
            data-testid="send-wallet-to"
          />
          <Input
            label="Amount (USDC)"
            inputMode="decimal"
            placeholder="0.00"
            value={sendAmt}
            onChange={(e) => {
              setSendResult(null);
              setSendAmt(e.target.value.replace(/[^0-9.]/g, ""));
            }}
            data-testid="send-wallet-amount"
          />
          <div className="rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 text-[12.5px] leading-relaxed text-[#7a5a12]">
            This is a <b>public on-chain payment</b> from your Public balance - visible to anyone and <b>can't be undone</b>. To pay a Benzo user privately instead, use Send privately to their @handle.
          </div>
          {sendResult?.error ? (
            <Reveal tone="danger" className="rounded-lg border border-danger/30 bg-danger/8 px-4 py-3 text-[12.5px] font-medium text-[#b4232a]" data-testid="send-wallet-error">
              {sendResult.error}
            </Reveal>
          ) : null}
          {sendResult?.onChain ? (
            <Reveal tone="success" className="rounded-lg border border-success/30 bg-success/8 px-4 py-3" data-testid="send-wallet-result">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1d7a52]">
                <Send size={14} /> Sent on-chain
              </div>
              {sendResult.txHash ? (
                <a href={explorerTxUrl(sendResult.txHash)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                  View on explorer <ArrowUpRight size={12} />
                </a>
              ) : null}
            </Reveal>
          ) : null}
        </div>
      </Modal>

      {/* ---- Receive modal (address + QR) ----------------------------------- */}
      <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive USDC">
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">
            Share this address (or QR) with any wallet or exchange to be paid in USDC. It lands in your <b>Public</b> balance - then Make private if you want it hidden.
          </p>
          {recvLoading && !recv ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Skeleton className="h-[168px] w-[168px] rounded-xl" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : recv?.address ? (
            <>
              <div className="flex justify-center">
                {QrCode({ value: recv.address, size: 168 }) ?? (
                  <div className="flex h-[168px] w-[168px] items-center justify-center rounded-xl border border-dashed border-border text-muted">
                    <QrIcon size={32} />
                  </div>
                )}
              </div>
              <div className="rounded-xl bg-canvas p-4">
                <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted">Your USDC address</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="break-all font-mono text-[12px] text-fg" data-testid="receive-address">{recv.address}</span>
                  <span className="flex-none"><CopyButton value={recv.address} /></span>
                </div>
                {recv.issuer ? (
                  <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted">
                    <span>Asset · {recv.asset}</span>
                    <AddressDisplay address={recv.issuer} head={4} tail={4} />
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-canvas p-6 text-center text-[13px] text-muted" data-testid="receive-unavailable">
              A receive address is available when connected to a live network.
            </div>
          )}
        </div>
      </Modal>
    </Screen>
  );
}

/** One key/value line inside the shared ceremony's details slot (dark surface). */
function CeremonyRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex-none text-white/48">{k}</span>
      <span className="min-w-0 truncate text-right font-semibold text-white">{v}</span>
    </div>
  );
}

/** Make-private on-chain receipt shown when the shield ceremony settles. */
function FundReceipt({ txHash }: { txHash?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 font-semibold text-white">
        <ShieldCheck size={15} /> Moved to Private on-chain
      </div>
      <div className="text-white/60">It's now a dual-controlled M-of-N org note - only you can see it.</div>
      {txHash ? (
        <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-white hover:underline">
          View on {NETWORK_LABEL} explorer <ArrowUpRight size={12} />
        </a>
      ) : null}
    </div>
  );
}

/**
 * Auditor receipt: the verdict + the Merkle root flipping into view + drill-down.
 * Only rendered on the confirmed on-chain path, so the proof is always verified.
 */
function ProveReceipt({ result, reduce }: { result: ProveResult; reduce: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-semibold text-white">
        <ShieldCheck size={15} /> {result.headline}
      </div>
      {result.ref?.root ? (
        <motion.div
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
          style={{ transformPerspective: 640 }}
          initial={reduce ? false : { rotateX: 90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          data-testid="prove-merkle-root"
        >
          <div className="text-[11px] uppercase tracking-wide text-white/45">Merkle root</div>
          <div className="break-all font-mono text-[12px] text-white/80">{result.ref.root}</div>
        </motion.div>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-white/60">
        <span>Verified on-chain. Anyone can re-check it.</span>
        {result.ref ? <OnChainDetail refData={result.ref} /> : null}
      </div>
    </div>
  );
}
