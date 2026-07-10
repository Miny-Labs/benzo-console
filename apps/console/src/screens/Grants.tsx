/**
 * Auditor grants - issue a scoped viewing key so an auditor sees exactly the
 * in-scope notes (a corridor/period), nothing else, and revoke it on-chain. This
 * is the two-sided compliance story: private by default, disclosable on your terms.
 */
import { useEffect, useReducer, useState } from "react";
import { Download, Eye, FileCheck, Plus, ShieldCheck, XCircle } from "lucide-react";
import type { DisclosureTier, ViewingGrant } from "@benzo/types";
import { initialPaymentState, paymentReducer } from "@benzo/ui/payment-state";
import { api, type OnChainRef } from "../lib/api";
import { validateViewingGrantForm } from "../lib/grants";
import { useConsole } from "../lib/store";
import { fmtUsd, formatAddress, formatDate, friendlyError } from "../lib/format";
import { CeremonyRow } from "../ui/CeremonyRow";
import { Screen, Stagger } from "../ui/motion";
import { OnChainDetail } from "../ui/onchain";
import { SendCeremony, type CeremonyTitles } from "../ui/SendCeremony";
import { Button, Card, EmptyState, Input, Modal, Pill, Select, Skeleton, StatusPill, useToast } from "../ui/primitives";

type PeriodTotal = Awaited<ReturnType<typeof api.periodTotalAttestation>>;

// Prove-flavored copy for the shared send ceremony: "disclose on your terms" is the
// eERC payoff, so the period-total attestation gets its own full-screen sequence.
const ATTEST_TITLES: CeremonyTitles = {
  encrypt: { title: "Loading the period's notes", sub: "Gathering the in-scope notes and building the witness" },
  settle: { title: "Folding the ORGSUM proof", sub: "Proving the total on-chain without revealing a single salary" },
  verify: { title: "Verified on-chain — Merkle root revealed", sub: "Here's your downloadable, re-verifiable attestation" },
  error: { title: "Couldn't prove the total" },
};

export function Grants() {
  const toast = useToast();
  const { grants: savedGrants, accounts, refresh, loading } = useConsole();
  const [grants, setGrants] = useState<ViewingGrant[]>(savedGrants);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ auditorName: "", auditorPubKey: "", tier: "outgoing" as DisclosureTier, label: "2026-Q2", accountId: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [period, setPeriod] = useState("2026-Q2");
  const [att, setAtt] = useState<PeriodTotal | null>(null);
  // The attestation plays through the shared send ceremony (state machine, not a
  // timer), so "generate auditor packet" is one full-screen animated action.
  const [attState, dispatchAtt] = useReducer(paymentReducer, initialPaymentState);
  // Confirm gate for an irreversible on-chain revoke that cuts auditor access.
  const [confirmRevoke, setConfirmRevoke] = useState<{ id: string; auditorName: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    setGrants(savedGrants);
  }, [savedGrants]);

  // Records export (Z2): generate a network-verified period-total attestation -
  // a real ORGSUM proof the auditor/tax office can re-verify on-chain. The
  // individual salaries that make up the total are never disclosed. The ceremony
  // is a slave to the result: it only reaches "verified" if the proof checked
  // on-chain, and fails clearly otherwise (privacy claim === on-chain proof).
  async function exportPeriodTotal() {
    dispatchAtt({ type: "START" });
    setAtt(null);
    try {
      const r = await api.periodTotalAttestation(period);
      setAtt(r);
      if (r.onChain) {
        // Batched jump; SendCeremony's flooring still walks encrypt→settle→verify.
        dispatchAtt({ type: "WITNESS_READY" });
        dispatchAtt({ type: "PROOF_READY" });
        dispatchAtt({ type: "SUBMITTED", txHash: r.root ?? "" });
        dispatchAtt({ type: "CONFIRMED", result: r });
      } else {
        const publicInputs = r.publicInputs ?? [];
        const emptyPeriod = publicInputs.length === 0 && Number(r.total ?? "0") === 0;
        dispatchAtt({
          type: "FAIL",
          error: !r.live
            ? "Not connected. Connect to a live network to generate a real attestation."
            : emptyPeriod
              ? "No private payroll notes exist for this period yet, so there's nothing to prove on-chain."
              : "The total was not verified on-chain, so no attestation was produced.",
        });
      }
    } catch (e) {
      dispatchAtt({ type: "FAIL", error: friendlyError(e) });
    }
  }

  function downloadAttestation() {
    if (!att) return;
    const blob = new Blob([JSON.stringify(att, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benzo-period-total-${att.period ?? period}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function create() {
    const auditorName = form.auditorName.trim();
    const auditorPubKey = form.auditorPubKey.trim();
    const validationError = validateViewingGrantForm({ auditorName, auditorPubKey });
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const grant = await api.createGrant({
        auditorName,
        auditorPubKey,
        tier: form.tier,
        scope: { accountIds: form.accountId ? [form.accountId] : [], from: null, to: null, label: form.label },
        expiry: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      });
      setGrants((prev) => [grant, ...prev.filter((g) => g.id !== grant.id)]);
      toast({ title: "Viewing grant issued", tone: "success" });
      setOpen(false);
      void refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(true);
    try {
      const grant = await api.revokeGrant(id);
      setGrants((prev) => prev.map((g) => (g.id === grant.id ? grant : g)));
      toast({ title: "Grant revoked", tone: "muted" });
      setConfirmRevoke(null);
      void refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setRevoking(false);
    }
  }

  // The attestation already carries everything needed to re-verify the ORGSUM
  // proof on-chain (the "P0 irony" the audit flagged: the data was there, the
  // drill-down wasn't). Surface it as an OnChainRef.
  const attRef: OnChainRef | undefined =
    att?.live && att.vkId
      ? {
          label: `Period total · ${att.period ?? period}`,
          vkId: att.vkId,
          verified: !!att.onChain,
          verifier: att.verifier,
          network: att.network,
          root: att.root,
          publics: (att.publicInputs ?? []).map((v, i) => ({ k: i === 0 ? "Total (committed)" : `public[${i}]`, v })),
        }
      : undefined;

  return (
    <Screen>
      <SendCeremony
        open={attState.phase !== "idle"}
        state={attState}
        eyebrow="Period attestation"
        titles={ATTEST_TITLES}
        details={
          <>
            <CeremonyRow k="Period" v={att?.period ?? period} />
            {att?.onChain && att.total ? <CeremonyRow k="Total (committed)" v={fmtUsd(att.total)} /> : null}
          </>
        }
        receipt={
          attState.phase === "confirmed" && att ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <ShieldCheck size={15} /> {att.period}: {fmtUsd(att.total ?? "0")}
              </div>
              <div className="text-[12px] text-white/56">
                The network verified this total against the ORGSUM proof. No single salary is revealed.
              </div>
              {att.root ? <div className="font-mono text-[12px] text-white/56">Merkle root {formatAddress(att.root, 8, 6)}</div> : null}
              {attRef ? <OnChainDetail refData={attRef} /> : null}
            </div>
          ) : undefined
        }
        primaryAction={
          attState.phase === "confirmed"
            ? { label: (<><Download size={14} /> Download attestation (.json)</>), onClick: downloadAttestation }
            : attState.phase === "failed"
              ? { label: "Close", onClick: () => dispatchAtt({ type: "RESET" }), variant: "danger" }
              : undefined
        }
        secondaryAction={
          attState.phase === "confirmed"
            ? { label: "Done", onClick: () => dispatchAtt({ type: "RESET" }), variant: "outline" }
            : undefined
        }
      />
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl">Auditor grants</h1>
          <p className="mt-1 text-[13.5px] text-muted">Read-only access for auditors. They see exactly what you grant, and nothing else.</p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="new-grant">
          <Plus size={15} /> New grant
        </Button>
      </div>

      <Card className="mb-5 p-5">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <FileCheck size={16} className="text-primary" /> Period total for tax / audit
        </div>
        <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
          Export a network-verified statement of what you paid out for a period, e.g. "Q2 = $X." The total is proven on-chain; the individual salaries behind it stay hidden. The file embeds the proof so your auditor can re-verify it independently.
        </p>
        <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-muted/80">
          Soundness: this proves the disclosed notes sum to the stated total - not that the set is complete. It attests the total you claim, it does not detect a payout deliberately left out (completeness is bounded only by the authorized-key registry).
        </p>
        <div className="mt-4 flex items-end gap-3">
          <div className="w-48">
            <Input label="Period" placeholder="2026-Q2" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="att-period" />
          </div>
          <Button onClick={exportPeriodTotal} data-testid="gen-period-total">
            <ShieldCheck size={15} /> Generate attestation
          </Button>
        </div>
      </Card>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Card key={i} className="flex items-center gap-4 p-5">
              <Skeleton className="h-11 w-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </Card>
          ))}
        </div>
      ) : grants.length === 0 ? (
        <EmptyState title="No grants yet" hint="Give an auditor read-only access to a specific period or account, and nothing else." />
      ) : (
        <Stagger className="space-y-4">
          {grants.map((g, i) => (
            <Stagger.Item key={g.id} index={i}>
              <Card className="flex items-center gap-4 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Eye size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[15px] font-semibold">
                    <span className="truncate">{g.auditorName}</span>
                    <Pill tone="shielded">{g.tier}</Pill>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-muted">
                    Scope: {g.scope.label ?? "All activity"} · expires {formatDate(g.expiry)}
                  </div>
                </div>
                <StatusPill status={g.status} />
                {g.status === "active" ? (
                  <Button variant="outline" onClick={() => setConfirmRevoke({ id: g.id, auditorName: g.auditorName })} data-testid="revoke-grant">
                    <XCircle size={15} /> Revoke
                  </Button>
                ) : null}
              </Card>
            </Stagger.Item>
          ))}
        </Stagger>
      )}

      <Modal
        open={open}
        onClose={() => { setOpen(false); setFormError(null); }}
        title="Issue a viewing grant"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={create} data-testid="grant-submit">
              <ShieldCheck size={15} /> Issue grant
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Auditor name" placeholder="External Auditor" value={form.auditorName} onChange={(e) => { setFormError(null); setForm({ ...form, auditorName: e.target.value }); }} data-testid="grant-name" error={formError?.includes("name") ? formError : undefined} />
          <Input label="Auditor public key" placeholder="0x…" value={form.auditorPubKey} onChange={(e) => { setFormError(null); setForm({ ...form, auditorPubKey: e.target.value }); }} data-testid="grant-pubkey" error={formError?.includes("public key") ? formError : undefined} />
          <Select label="Disclosure tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as DisclosureTier })}>
            <option value="outgoing">Outgoing only</option>
            <option value="incoming">Incoming only</option>
            <option value="full">Full</option>
          </Select>
          <Input label="What this covers" placeholder="Q2 payroll" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <Select label="Account scope" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </Modal>

      <Modal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        title="Revoke this viewing grant"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button variant="danger" loading={revoking} onClick={() => confirmRevoke && revoke(confirmRevoke.id)} data-testid="revoke-grant-confirm">
              <XCircle size={15} /> Revoke access
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          This revokes <b>{confirmRevoke?.auditorName}</b>'s read-only access on-chain, immediately. They'll lose visibility into the granted scope and you can't undo it - you'd have to issue a new grant.
        </p>
      </Modal>
    </Screen>
  );
}
