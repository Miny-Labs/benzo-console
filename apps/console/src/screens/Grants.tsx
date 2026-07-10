/**
 * Auditor access — issue a scoped, read-only viewing key so an auditor sees exactly
 * the in-scope notes (a corridor/period), nothing else, and revoke it on-chain. Two
 * tabs: Access (the grant register + revoke) and Attestations (a network-verified
 * period-total report). Private by default, disclosable on your terms.
 */
import { useEffect, useReducer, useState } from "react";
import { Download, FileCheck, Plus, ShieldCheck, XCircle } from "lucide-react";
import type { DisclosureTier, ViewingGrant } from "@benzo/types";
import { initialPaymentState, paymentReducer } from "@benzo/ui/payment-state";
import { api, type OnChainRef } from "../lib/api";
import { validateViewingGrantForm } from "../lib/grants";
import { useConsole } from "../lib/store";
import { fmtDate, fmtUsd, formatAddress, friendlyError } from "../lib/format";
import { CeremonyRow } from "../ui/CeremonyRow";
import { Screen } from "../ui/motion";
import { OnChainDetail } from "../ui/onchain";
import { SendCeremony, type CeremonyTitles } from "../ui/SendCeremony";
import {
  Button,
  Card,
  EmptyState,
  Input,
  MetaPill,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  useToast,
} from "../ui/primitives";

type PeriodTotal = Awaited<ReturnType<typeof api.periodTotalAttestation>>;
type TabId = "access" | "attestations";
type AccessFilter = "active" | "inactive";

/** De-jargoned disclosure tiers — no bare "outgoing"/"incoming"/"full" in the UI. */
const TIER_LABEL: Record<DisclosureTier, string> = {
  full: "Full access",
  incoming: "Incoming payments",
  outgoing: "Outgoing payments",
};

// Prove-flavored copy for the shared send ceremony.
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
  const [tab, setTab] = useState<TabId>("access");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("active");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ auditorName: "", auditorPubKey: "", tier: "outgoing" as DisclosureTier, label: "2026-Q2", accountId: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [period, setPeriod] = useState("2026-Q2");
  const [att, setAtt] = useState<PeriodTotal | null>(null);
  const [attState, dispatchAtt] = useReducer(paymentReducer, initialPaymentState);
  const [confirmRevoke, setConfirmRevoke] = useState<{ id: string; auditorName: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    setGrants(savedGrants);
  }, [savedGrants]);

  const activeGrants = grants.filter((g) => g.status === "active");
  const inactiveGrants = grants.filter((g) => g.status !== "active");
  const rows = accessFilter === "active" ? activeGrants : inactiveGrants;

  // Records export: a real ORGSUM proof the auditor/tax office can re-verify on-chain.
  // The ceremony only reaches "verified" if the proof checked on-chain.
  async function exportPeriodTotal() {
    dispatchAtt({ type: "START" });
    setAtt(null);
    try {
      const r = await api.periodTotalAttestation(period);
      setAtt(r);
      if (r.onChain) {
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
      toast({ title: "Auditor access granted", tone: "success" });
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
      toast({ title: "Access revoked", tone: "muted" });
      setConfirmRevoke(null);
      void refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setRevoking(false);
    }
  }

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

      <PageHeader
        title="Auditor access"
        subtitle="Read-only access for auditors. They see exactly what you grant, and nothing else."
        action={
          <Button onClick={() => setOpen(true)} data-testid="new-grant">
            <Plus size={15} /> Grant access
          </Button>
        }
      />

      <div className="mb-4">
        <Tabs
          items={[
            { id: "access", label: "Access" },
            { id: "attestations", label: "Attestations" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "access" ? (
        <>
          <div className="mb-3 inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Access filter">
            {(["active", "inactive"] as AccessFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={accessFilter === f}
                onClick={() => setAccessFilter(f)}
                data-testid={`access-filter-${f}`}
                className={`rounded-md px-3 py-1 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  accessFilter === f ? "bg-primary/[0.08] text-primary" : "text-muted hover:text-fg"
                }`}
              >
                {f === "active" ? `Active (${activeGrants.length})` : `Inactive (${inactiveGrants.length})`}
              </button>
            ))}
          </div>

          {loading ? (
            <Card className="p-0">
              <div className="divide-y divide-border">
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="ml-auto h-5 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            </Card>
          ) : rows.length === 0 ? (
            <EmptyState
              title={accessFilter === "active" ? "No active auditor access" : "No revoked or expired access"}
              hint={accessFilter === "active" ? "Grant an auditor read-only access to a specific period or account, and nothing else." : "Revoked and expired grants will appear here."}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Auditor</Th>
                  <Th>Scope</Th>
                  <Th>Created</Th>
                  <Th>Expires</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <Tr key={g.id} data-testid="grant-row">
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg">{g.auditorName}</span>
                        <MetaPill>{TIER_LABEL[g.tier]}</MetaPill>
                      </div>
                    </Td>
                    <Td>{g.scope.label ?? "All activity"}</Td>
                    <Td>{fmtDate(g.createdAt)}</Td>
                    <Td>{fmtDate(g.expiry)}</Td>
                    <Td>
                      <StatusPill status={g.status} />
                    </Td>
                    <Td align="right">
                      {g.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="!border-danger/40 !text-danger hover:!bg-danger/8"
                          onClick={() => setConfirmRevoke({ id: g.id, auditorName: g.auditorName })}
                          data-testid="revoke-grant"
                        >
                          <XCircle size={14} /> Revoke
                        </Button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : (
        <Card>
          <div className="flex items-center gap-2 t-card-title text-fg">
            <FileCheck size={16} className="text-primary" /> Period total for tax / audit
          </div>
          <p className="t-helper mt-1 max-w-2xl">
            Export a network-verified statement of what you paid out for a period — the total is proven on-chain; the individual
            salaries stay hidden. The file embeds the proof so your auditor can re-verify it independently.
          </p>
          <div className="mt-4 flex items-end gap-3">
            <div className="w-48">
              <Input label="Period" placeholder="2026-Q2" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="att-period" />
            </div>
            <Button onClick={exportPeriodTotal} data-testid="gen-period-total">
              <ShieldCheck size={15} /> Generate attestation
            </Button>
          </div>
          <details className="mt-4 text-[12.5px] text-muted">
            <summary className="cursor-pointer select-none font-medium text-fg outline-none focus-visible:ring-2 focus-visible:ring-primary/40">Technical details</summary>
            <p className="mt-2 max-w-2xl leading-relaxed">
              Soundness: this proves the disclosed notes sum to the stated total — not that the set is complete. It attests the total
              you claim; it does not detect a payout deliberately left out (completeness is bounded only by the authorized-key registry).
            </p>
          </details>
        </Card>
      )}

      {/* Grant access modal */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setFormError(null); }}
        title="Grant auditor access"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={create} data-testid="grant-submit">
              <ShieldCheck size={15} /> Grant access
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Auditor name" placeholder="External Auditor" value={form.auditorName} onChange={(e) => { setFormError(null); setForm({ ...form, auditorName: e.target.value }); }} data-testid="grant-name" error={formError?.includes("name") ? formError : undefined} />
          <Input label="Auditor public key" placeholder="0x…" value={form.auditorPubKey} onChange={(e) => { setFormError(null); setForm({ ...form, auditorPubKey: e.target.value }); }} data-testid="grant-pubkey" error={formError?.includes("public key") ? formError : undefined} />
          <Select label="Disclosure tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as DisclosureTier })}>
            <option value="outgoing">Outgoing payments</option>
            <option value="incoming">Incoming payments</option>
            <option value="full">Full access</option>
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

      {/* Revoke confirm */}
      <Modal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        title="Revoke auditor access"
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
          This revokes <b>{confirmRevoke?.auditorName}</b>'s read-only access on-chain, immediately. They'll lose visibility into the
          granted scope and you can't undo it — you'd have to grant new access.
        </p>
      </Modal>
    </Screen>
  );
}
