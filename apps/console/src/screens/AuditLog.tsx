/**
 * Audit log — the tamper-evident double-entry ledger on screen. Every shielded
 * movement projects to a balanced entry whose hash commits to the one before it, so
 * any after-the-fact edit/insert/delete breaks the chain. A dense, filterable table
 * (search, date range, event, account, status, export) with a per-row detail drawer.
 * "Generate auditor packet" re-walks the chain, folds every encrypted event under one
 * Merkle root, and anchors it on-chain — one full-screen, re-verifiable disclosure.
 */
import { useEffect, useMemo, useReducer, useState } from "react";
import { CheckCircle2, Download, ExternalLink, ScrollText, Search, ShieldAlert, X } from "lucide-react";
import type { LedgerEntry, LedgerSourceType } from "@benzo/types";
import { initialPaymentState, paymentReducer } from "@benzo/ui/payment-state";
import { api, type PrivateAuditAnchorResponse, type PrivateAuditPacketResponse } from "../lib/api";
import { explorerTxUrl, fmtDateTime, fmtUsd, formatAddress, friendlyError, minorToUsdc } from "../lib/format";
import { CeremonyRow } from "../ui/CeremonyRow";
import { AnimatePresence, motion, Screen } from "../ui/motion";
import { SendCeremony, type CeremonyTitles } from "../ui/SendCeremony";
import { Button, Card, CopyButton, EmptyState, Input, MetaPill, PageHeader, Pill, Select, Skeleton, Table, Td, Th, Tr } from "../ui/primitives";

const PAGE_SIZE = 12;

const EVENT_LABEL: Record<LedgerSourceType, string> = {
  shield: "Moved to private",
  transfer: "Private transfer",
  unshield: "Moved to public",
  payroll: "Payroll run",
  invoice: "Invoice paid",
  onramp: "Deposit",
  offramp: "Withdrawal",
  fee: "Network fee",
  reversal: "Reversal",
};

const ALL_EVENTS = Object.keys(EVENT_LABEL) as LedgerSourceType[];

// `finalityOf` only ever yields confirmed / pending / reversed for a ledger entry
// (there's no failure signal on the model), so "failed" was unreachable everywhere
// it appeared — the pill branch and the status-filter option both included a state
// no row could ever have. Dropped it until the ledger actually surfaces failures.
type Finality = "confirmed" | "pending" | "reversed";
const FINALITY_LABEL: Record<Finality, string> = { confirmed: "Confirmed", pending: "Pending", reversed: "Reversed" };

// Prove-flavored copy for the shared send ceremony. The packet is only "verified"
// once its Merkle root is anchored on-chain; anything short of that fails clearly.
const PACKET_TITLES: CeremonyTitles = {
  encrypt: { title: "Re-walking the audit chain", sub: "Re-hashing every entry and gathering the encrypted events" },
  settle: { title: "Folding the audit proof", sub: "Committing the Merkle root and anchoring it on-chain" },
  verify: { title: "Anchored on-chain — Merkle root revealed", sub: "Here's your downloadable, re-verifiable packet" },
  error: { title: "Couldn't seal the packet" },
};

/** Gross of an entry = sum of its credit legs (debits net to the same number). */
function entryGross(e: LedgerEntry): string {
  return e.lines.filter((l) => l.direction === "credit").reduce((s, l) => s + BigInt(l.amount), 0n).toString();
}

/** The account value lands in (credit leg), for the Account column. */
function accountFor(e: LedgerEntry): string {
  return e.lines.find((l) => l.direction === "credit")?.accountId ?? e.lines[0]?.accountId ?? "";
}

/** "acct_operating" -> "Operating" — a friendly bucket label, no store needed. */
function accountLabel(id: string): string {
  const base = id.replace(/^acct_/, "").replace(/_/g, " ");
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "—";
}

/** Settlement finality of an entry. */
function finalityOf(e: LedgerEntry): Finality {
  if (e.sourceType === "reversal" || e.reversalOf) return "reversed";
  if (e.txId) return "confirmed";
  return "pending";
}

function FinalityPill({ f }: { f: Finality }) {
  if (f === "confirmed") return <Pill tone="success">Confirmed</Pill>;
  if (f === "pending") return <Pill tone="warning">Pending</Pill>;
  return <MetaPill>Reversed</MetaPill>;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function AuditLog() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Auditor packet ceremony (kept verbatim: verify -> fold -> anchor).
  const [packetState, dispatchPacket] = useReducer(paymentReducer, initialPaymentState);
  const [integrity, setIntegrity] = useState<{ ok: boolean; length: number; brokenAt?: number } | null>(null);
  const [packet, setPacket] = useState<PrivateAuditPacketResponse["packet"] | null>(null);
  const [anchor, setAnchor] = useState<PrivateAuditAnchorResponse["anchor"] | null>(null);

  // Filters + pagination + detail drawer.
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState<"all" | LedgerSourceType>("all");
  const [accountFilter, setAccountFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Finality>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<LedgerEntry | null>(null);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    api
      .ledger()
      .then((r) => live && setEntries(r))
      .catch((e) => {
        if (!live) return;
        setLoadError(friendlyError(e, "Couldn't load the audit log."));
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const accountOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries ?? []) for (const l of e.lines) ids.add(l.accountId);
    return [...ids];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (eventType !== "all" && e.sourceType !== eventType) return false;
      if (statusFilter !== "all" && finalityOf(e) !== statusFilter) return false;
      if (accountFilter !== "all" && !e.lines.some((l) => l.accountId === accountFilter)) return false;
      // Both bounds parsed as LOCAL start/end-of-day — bare `new Date("2026-07-10")`
      // is UTC midnight, which would slice the day off by the viewer's tz offset.
      if (dateFrom && new Date(e.postedAt) < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && new Date(e.postedAt) > new Date(`${dateTo}T23:59:59`)) return false;
      if (q) {
        const hay = [e.hash, e.txId, e.sourceId, e.id].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, eventType, statusFilter, accountFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => setPage(0), [search, eventType, statusFilter, accountFilter, dateFrom, dateTo]);
  // Escape closes the detail drawer — the dialog affordance keyboard users expect.
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail]);

  async function generatePacket() {
    dispatchPacket({ type: "START" });
    setIntegrity(null);
    setPacket(null);
    setAnchor(null);
    try {
      const chain = await api.ledgerVerify();
      setIntegrity(chain);
      if (!chain.ok) {
        const at = chain.brokenAt != null ? `entry #${chain.brokenAt}` : "an entry";
        dispatchPacket({ type: "FAIL", error: `Tampering detected at ${at}. The chain is broken from there on.` });
        return;
      }
      dispatchPacket({ type: "WITNESS_READY" });

      const built = await api.privateAuditPacket();
      setPacket(built.packet);
      if (!built.integrity.ok) {
        const at = built.integrity.brokenAt != null ? `entry #${built.integrity.brokenAt}` : "an entry";
        dispatchPacket({ type: "FAIL", error: `The private event chain failed integrity at ${at}.` });
        return;
      }
      dispatchPacket({ type: "PROOF_READY" });

      const anchored = await api.anchorPrivateAuditRoot({ packet: built.packet });
      setPacket(anchored.packet);
      setAnchor(anchored.anchor);
      if (anchored.anchor.onChain) {
        dispatchPacket({ type: "SUBMITTED", txHash: anchored.anchor.txHash ?? "" });
        dispatchPacket({ type: "CONFIRMED", result: anchored });
      } else {
        dispatchPacket({ type: "FAIL", error: anchored.anchor.error ?? "The audit root was not anchored on-chain. Connect to a live network for a re-verifiable packet." });
      }
    } catch (e) {
      dispatchPacket({ type: "FAIL", error: friendlyError(e, "Couldn't generate the auditor packet.") });
    }
  }

  function downloadPacket() {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benzo-auditor-packet-${packet.scope.label}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const header = ["Date & time", "Event", "Reference", "Account", "Amount (USDC)", "Status", "Receipt"];
    const lines = filtered.map((e) =>
      [
        fmtDateTime(e.postedAt),
        EVENT_LABEL[e.sourceType],
        e.hash ?? "",
        accountLabel(accountFor(e)),
        minorToUsdc(entryGross(e)),
        FINALITY_LABEL[finalityOf(e)],
        e.txId ? explorerTxUrl(e.txId) : "",
      ].map(csvCell).join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "benzo-audit-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Screen>
      <SendCeremony
        open={packetState.phase !== "idle"}
        state={packetState}
        eyebrow="Auditor packet"
        titles={PACKET_TITLES}
        details={<CeremonyRow k="Scope" v={packet?.scope.label ?? "All private events"} />}
        receipt={
          packetState.phase === "confirmed" && packet ? (
            <div className="space-y-2" data-testid="packet-receipt">
              <div className="flex items-center gap-2 font-semibold text-white">
                <CheckCircle2 size={15} /> Chain intact · {integrity?.length ?? packet.envelopes.length} entries verified
              </div>
              <div className="text-[12px] text-white/56">
                {packet.envelopes.length} encrypted events sealed under one Merkle root. Records stay ciphertext; only the root goes on-chain.
              </div>
              <div className="font-mono text-[12px] text-white/56">Merkle root {formatAddress(packet.anchor.merkleRoot, 8, 6)}</div>
              {anchor?.onChain ? <div className="font-mono text-[12px] text-white/56">On-chain · sequence {anchor.sequence}</div> : null}
              {anchor?.explorer ? (
                <a href={anchor.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
                  View root transaction <ExternalLink size={12} />
                </a>
              ) : null}
            </div>
          ) : undefined
        }
        primaryAction={
          packetState.phase === "confirmed"
            ? { label: (<><Download size={14} /> Download packet (.json)</>), onClick: downloadPacket }
            : packetState.phase === "failed"
              ? { label: "Close", onClick: () => dispatchPacket({ type: "RESET" }), variant: "danger" }
              : undefined
        }
        secondaryAction={
          packetState.phase === "confirmed" ? { label: "Done", onClick: () => dispatchPacket({ type: "RESET" }), variant: "outline" } : undefined
        }
      />

      <PageHeader
        title="Audit log"
        subtitle="A tamper-evident double-entry record of every movement. Corrections are reversals, never edits."
        action={
          <Button onClick={generatePacket} loading={packetState.phase !== "idle"} data-testid="generate-packet">
            <ShieldAlert size={15} /> Generate auditor packet
          </Button>
        }
      />

      {/* Filters */}
      <Card compact className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reference or hash…"
              data-testid="audit-search"
              className="h-11 w-full rounded-lg border border-border bg-bg pl-9 pr-3 text-sm text-fg outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Select value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)} data-testid="audit-event">
            <option value="all">All events</option>
            {ALL_EVENTS.map((s) => (
              <option key={s} value={s}>{EVENT_LABEL[s]}</option>
            ))}
          </Select>
          <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} data-testid="audit-account">
            <option value="all">All accounts</option>
            {accountOptions.map((id) => (
              <option key={id} value={id}>{accountLabel(id)}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} data-testid="audit-status">
            <option value="all">All statuses</option>
            {(Object.keys(FINALITY_LABEL) as Finality[]).map((f) => (
              <option key={f} value={f}>{FINALITY_LABEL[f]}</option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="audit-from" />
            <span className="text-muted">–</span>
            <Input type="date" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="audit-to" />
          </div>
          <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-3">
            <span className="t-helper">Times shown in your local timezone</span>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} data-testid="audit-export">
              <Download size={14} /> Export CSV
            </Button>
          </div>
        </div>
      </Card>

      {loadError && entries === null ? (
        <Card className="p-8 text-center">
          <div className="text-sm font-medium text-fg">{loadError}</div>
          <div className="mt-3">
            <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)} data-testid="audit-retry">Try again</Button>
          </div>
        </Card>
      ) : entries === null ? (
        <Card className="p-0">
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="ml-auto h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      ) : entries.length === 0 ? (
        <EmptyState title="No entries yet" hint="Ledger entries appear here as soon as money moves: a shield, a payroll run, an invoice paid." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching entries" hint="Try clearing a filter or widening the date range." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Date &amp; time</Th>
                <Th>Event</Th>
                <Th>Reference</Th>
                <Th>Account</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th align="right">Receipt</Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e) => (
                <Tr
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${EVENT_LABEL[e.sourceType]} — open details`}
                  onClick={() => setDetail(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      setDetail(e);
                    }
                  }}
                  data-testid="audit-row"
                >
                  <Td className="!py-4 whitespace-nowrap">{fmtDateTime(e.postedAt)}</Td>
                  <Td className="!py-4 font-medium text-fg">{EVENT_LABEL[e.sourceType]}</Td>
                  <Td className="!py-4">
                    {e.hash ? (
                      <span className="inline-flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>
                        <span className="font-mono text-[12px] text-muted">{formatAddress(e.hash, 6, 4)}</span>
                        <CopyButton value={e.hash} />
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="!py-4">{accountLabel(accountFor(e))}</Td>
                  <Td align="right" className="!py-4 tnum">{fmtUsd(entryGross(e))}</Td>
                  <Td className="!py-4"><FinalityPill f={finalityOf(e)} /></Td>
                  <Td align="right" className="!py-4">
                    {e.txId ? (
                      <a
                        href={explorerTxUrl(e.txId)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        Receipt <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>

          <div className="mt-3 flex items-center justify-between">
            <span className="t-helper">
              Showing {pageClamped * PAGE_SIZE + 1}–{Math.min((pageClamped + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={pageClamped === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} data-testid="audit-prev">
                Previous
              </Button>
              <span className="t-helper">Page {pageClamped + 1} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={pageClamped >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} data-testid="audit-next">
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Detail side-drawer */}
      <AnimatePresence>
        {detail ? (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-fg/30 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetail(null)}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={`${EVENT_LABEL[detail.sourceType]} details`}
              className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              data-testid="audit-drawer"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <div className="t-card-title text-fg">{EVENT_LABEL[detail.sourceType]}</div>
                <button type="button" onClick={() => setDetail(null)} aria-label="Close" className="rounded-md p-1 text-muted outline-none transition hover:bg-border/50 focus-visible:ring-2 focus-visible:ring-primary/40">
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-4 px-5 py-4">
                <dl className="divide-y divide-border rounded-lg border border-border bg-bg px-4 py-1 text-sm">
                  <DrawerRow label="Date &amp; time" value={fmtDateTime(detail.postedAt)} />
                  <DrawerRow label="Event" value={EVENT_LABEL[detail.sourceType]} />
                  <DrawerRow label="Status" value={<FinalityPill f={finalityOf(detail)} />} />
                  <DrawerRow label="Amount" value={fmtUsd(entryGross(detail))} />
                  {detail.sourceId ? <DrawerRow label="Source" value={<span className="font-mono text-[12px]">{detail.sourceId}</span>} /> : null}
                </dl>

                <div>
                  <div className="t-label mb-1.5 text-muted">Reference (audit hash)</div>
                  {detail.hash ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                      <span className="break-all font-mono text-[12px] text-fg">{detail.hash}</span>
                      <span className="flex-none"><CopyButton value={detail.hash} /></span>
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>

                <div>
                  <div className="t-label mb-1.5 text-muted">Double-entry legs</div>
                  <div className="divide-y divide-border rounded-lg border border-border bg-bg">
                    {detail.lines.map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="text-fg">{accountLabel(l.accountId)}</span>
                        <span className="flex items-center gap-2">
                          <MetaPill>{l.direction}</MetaPill>
                          <span className="tnum font-medium text-fg">{fmtUsd(l.amount)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {detail.txId ? (
                  <a
                    href={explorerTxUrl(detail.txId)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    View on-chain receipt <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </Screen>
  );
}

function DrawerRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );
}
