/**
 * Invoices — AP inbox and the second front-door into the pay engine. Contractor /
 * vendor invoices land here and settle through the SAME maker-checker + confidential
 * settlement as a payroll run (over the policy threshold → Approvals first).
 *
 * Enterprise-finance table: Select · Invoice · Payee · Due date · Status · Amount ·
 * Actions. Reviewing a selection is safer than a blind "Pay all", so the bulk action
 * opens a review before anything moves. Real date-only due dates, a derived
 * Open/Due soon/Overdue/Paid lifecycle, and Open/Paid/All tabs.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Invoice, PaymentOrder } from "@benzo/types";
import { api, type ApprovalProgressView } from "../lib/api";
import { useConsole } from "../lib/store";
import { USDC_SCALE, explorerTxUrl, fmtDate, formatMoney, friendlyError } from "../lib/format";
import { Screen } from "../ui/motion";
import {
  Amount,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  PrivacyDisclosure,
  Skeleton,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  useToast,
} from "../ui/primitives";

/** Anything over this proposed amount routes to Approvals before it can settle. */
const APPROVAL_THRESHOLD = 10_000n * BigInt(USDC_SCALE);
/** A due date within this many days reads as "Due soon". */
const DUE_SOON_DAYS = 7;

type TabId = "open" | "paid" | "all";

interface InvoicePacket {
  v?: number;
  counterpartyName?: string;
  handle?: string;
  invoice?: Invoice;
}

function decodeB64url(s: string): string {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function packetFromHash(hash: string): InvoicePacket | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const raw = q.get("import");
  if (!raw) return null;
  try {
    const packet = JSON.parse(decodeB64url(raw)) as InvoicePacket;
    if (!packet.invoice?.id || !packet.invoice.total?.amount || !Array.isArray(packet.invoice.lineItems)) return null;
    return packet;
  } catch {
    return null;
  }
}

/** An invoice is payable (and selectable) until it's paid, cancelled, or still a draft. */
function isPayable(inv: Invoice): boolean {
  return inv.status !== "paid" && inv.status !== "cancelled" && inv.status !== "draft";
}

/**
 * Display lifecycle — derives Due soon / Overdue from a real due date so the pill
 * carries operational meaning (never leaks a spurious time; dates render date-only).
 * Terminal states pass through unchanged.
 */
function displayStatus(inv: Invoice): string {
  if (inv.status === "paid") return "paid";
  if (inv.status === "partially_paid") return "partially_paid";
  if (inv.status === "cancelled") return "cancelled";
  if (inv.dueDate) {
    const days = (new Date(inv.dueDate).getTime() - Date.now()) / 86_400_000;
    if (days < 0) return "overdue";
    if (days <= DUE_SOON_DAYS) return "due_soon";
  }
  return "open";
}

export function Invoices() {
  const toast = useToast();
  const { invoices, counterparties, payments = [], masked, refresh, loading } = useConsole();
  const name = (id?: string) => counterparties.find((c) => c.id === id)?.name ?? "Unknown";
  const money = (minor: string, code?: string) => (masked ? "••••••" : <Amount minor={minor} code={code} tabular />);

  const [tab, setTab] = useState<TabId>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<Invoice | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [payingAll, setPayingAll] = useState(false);
  const [importing, setImporting] = useState(false);

  // Wallet → console handoff: a hosted-invoice packet in the URL hash is imported
  // through the same createInvoice API, then the hash is cleared.
  useEffect(() => {
    const packet = packetFromHash(window.location.hash);
    if (!packet?.invoice) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    let cancelled = false;
    setImporting(true);
    api
      .createInvoice({
        counterpartyId: packet.invoice.counterpartyId,
        number: packet.invoice.number,
        lineItems: packet.invoice.lineItems,
        assetCode: packet.invoice.total.assetCode,
        dueDate: packet.invoice.dueDate,
        externalId: packet.invoice.externalId ?? packet.invoice.id,
        counterpartyName: packet.counterpartyName,
        handle: packet.handle,
      })
      .then(async () => {
        if (cancelled) return;
        await refresh();
        toast({ title: "Invoice imported", tone: "success" });
      })
      .catch((e) => {
        if (!cancelled) toast({ title: friendlyError(e, "Couldn't import this invoice."), tone: "danger" });
      })
      .finally(() => {
        if (!cancelled) setImporting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, toast]);

  const openInvoices = useMemo(() => invoices.filter(isPayable), [invoices]);
  const paidInvoices = useMemo(() => invoices.filter((i) => i.status === "paid"), [invoices]);
  const rows = tab === "open" ? openInvoices : tab === "paid" ? paidInvoices : invoices;

  // Selection is scoped to payable rows that are actually visible in the current tab.
  const selectableRows = rows.filter(isPayable);
  const selectedRows = openInvoices.filter((i) => selected.has(i.id));
  const selectedTotal = selectedRows.reduce((s, i) => s + BigInt(i.total.amount), 0n).toString();
  const someNeedApproval = selectedRows.some((i) => BigInt(i.total.amount) > APPROVAL_THRESHOLD);
  const allSelected = selectableRows.length > 0 && selectableRows.every((i) => selected.has(i.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (selectableRows.every((i) => prev.has(i.id))) {
        const next = new Set(prev);
        for (const i of selectableRows) next.delete(i.id);
        return next;
      }
      const next = new Set(prev);
      for (const i of selectableRows) next.add(i.id);
      return next;
    });
  }

  /** The settled payment behind a paid invoice — carries the on-chain receipt + date. */
  const paymentFor = (inv: Invoice) => payments.find((p) => inv.paymentOrderIds.includes(p.id));

  async function pay(inv: Invoice) {
    setBusy(inv.id);
    try {
      const r = await api.payInvoice(inv.id);
      const prog = (r.payment as PaymentOrder & { progress?: ApprovalProgressView }).progress;
      const queued = prog && !prog.satisfied;
      toast({
        title: queued
          ? `Submitted for approval · needs ${prog?.nextRole ?? "an approver"}`
          : r.invoice.status === "paid"
            ? "Invoice paid privately"
            : "Payment did not settle on-chain",
        tone: queued || r.invoice.status === "paid" ? "success" : "danger",
      });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(inv.id);
        return next;
      });
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  // Bulk review → pay: run each selected invoice through the SAME engine. Lines resolve
  // independently — some settle, some route to Approvals — so we report both counts.
  async function paySelected() {
    setPayingAll(true);
    let paid = 0;
    let queued = 0;
    let failed = 0;
    for (const inv of selectedRows) {
      try {
        const r = await api.payInvoice(inv.id);
        const prog = (r.payment as PaymentOrder & { progress?: ApprovalProgressView }).progress;
        if (prog && !prog.satisfied) queued++;
        else paid++;
      } catch {
        failed++;
      }
    }
    await refresh();
    setPayingAll(false);
    setBulkOpen(false);
    setSelected(new Set());
    toast({
      title: `${paid} paid${queued ? ` · ${queued} submitted for approval` : ""}${failed ? ` · ${failed} failed` : ""}`,
      tone: failed ? "danger" : "success",
    });
  }

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "open", label: `Open (${openInvoices.length})` },
    { id: "paid", label: `Paid (${paidInvoices.length})` },
    { id: "all", label: `All (${invoices.length})` },
  ];

  return (
    <Screen>
      <PageHeader
        title="Invoices"
        subtitle="Contractor and vendor invoices, paid through the same private, approved settlement as payroll."
      />

      <div className="mb-4">
        <Tabs items={tabs} active={tab} onChange={setTab} />
      </div>

      {/* Selection bar — appears once at least one payable row is checked. Review, don't blind-pay. */}
      {selected.size > 0 ? (
        <Card compact className="mb-4 flex flex-wrap items-center justify-between gap-3" data-testid="selection-bar">
          <div className="t-body text-fg">
            <span className="font-semibold">{selected.size}</span> selected ·{" "}
            {masked ? "••••••" : <span className="font-semibold">{formatMoney(selectedTotal)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkOpen(true)} data-testid="review-selected">
              Review {selected.size} payment{selected.size === 1 ? "" : "s"}
            </Button>
          </div>
        </Card>
      ) : null}

      {loading ? (
        <Card className="p-0">
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-5 w-20 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </Card>
      ) : importing ? (
        <Card>
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-3 h-3 w-40" />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title={tab === "paid" ? "No paid invoices yet" : "Inbox zero"}
          hint={tab === "paid" ? "Paid invoices will appear here with their on-chain receipts." : "No invoices waiting to be paid."}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-10">
                {selectableRows.length > 0 ? (
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border accent-[var(--color-primary)]"
                    data-testid="select-all"
                  />
                ) : null}
              </Th>
              <Th>Invoice</Th>
              <Th>Payee</Th>
              <Th>Due date</Th>
              <Th>Status</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => {
              const payable = isPayable(inv);
              const status = displayStatus(inv);
              const pmt = inv.status === "paid" ? paymentFor(inv) : undefined;
              const receipt = pmt?.settlement?.txHash;
              return (
                <Tr key={inv.id} data-testid="invoice-row">
                  <Td>
                    {payable ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${inv.number}`}
                        checked={selected.has(inv.id)}
                        onChange={() => toggleOne(inv.id)}
                        className="h-4 w-4 rounded border-border accent-[var(--color-primary)]"
                        data-testid="invoice-select"
                      />
                    ) : null}
                  </Td>
                  <Td>
                    <div className="font-medium text-fg">{inv.number}</div>
                    {inv.lineItems[0]?.description ? (
                      <div className="t-helper max-w-[240px] truncate">{inv.lineItems[0].description}</div>
                    ) : null}
                  </Td>
                  <Td>{name(inv.counterpartyId)}</Td>
                  <Td>{inv.dueDate ? fmtDate(inv.dueDate) : "—"}</Td>
                  <Td>
                    <StatusPill status={status} />
                  </Td>
                  <Td align="right" className="tnum">
                    {money(inv.total.amount)}
                  </Td>
                  <Td align="right">
                    {payable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy === inv.id}
                        onClick={() => setReview(inv)}
                        data-testid="review-invoice"
                      >
                        {BigInt(inv.total.amount) > APPROVAL_THRESHOLD ? "Submit for approval" : "Review"}
                      </Button>
                    ) : pmt ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="t-helper">Paid {fmtDate(pmt.updatedAt)}</span>
                        {receipt ? (
                          <a
                            href={explorerTxUrl(receipt)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                            data-testid="invoice-receipt"
                          >
                            Receipt <ExternalLink size={12} />
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* Single-invoice review */}
      <Modal
        open={!!review}
        onClose={() => busy !== review?.id && setReview(null)}
        title="Review payment"
        footer={
          review ? (
            <>
              <Button variant="ghost" onClick={() => setReview(null)} disabled={busy === review.id}>
                Cancel
              </Button>
              <Button
                loading={busy === review.id}
                onClick={() => {
                  const inv = review;
                  setReview(null);
                  if (inv) void pay(inv);
                }}
                data-testid="review-confirm"
              >
                {BigInt(review.total.amount) > APPROVAL_THRESHOLD ? "Submit for approval" : "Pay privately"}
              </Button>
            </>
          ) : null
        }
      >
        {review ? (
          <div className="flex flex-col gap-4">
            <dl className="rounded-lg border border-border bg-bg px-4 py-3 text-sm">
              <Row label="Invoice" value={review.number} />
              <Row label="Payee" value={name(review.counterpartyId)} />
              <Row label="Due date" value={review.dueDate ? fmtDate(review.dueDate) : "—"} />
              <Row label="Amount" value={masked ? "••••••" : <Amount minor={review.total.amount} code="USDC" />} />
              <Row label="Network fee" value={<span className="text-success">Free</span>} />
            </dl>
            {BigInt(review.total.amount) > APPROVAL_THRESHOLD ? (
              <p className="t-helper">
                This is over your approval limit, so it routes to Approvals for maker-checker before it settles.
              </p>
            ) : null}
            <PrivacyDisclosure hidden={["Amount", "Recipient"]} />
          </div>
        ) : null}
      </Modal>

      {/* Bulk review */}
      <Modal
        open={bulkOpen}
        onClose={() => !payingAll && setBulkOpen(false)}
        title={`Review ${selected.size} payment${selected.size === 1 ? "" : "s"}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={payingAll}>
              Cancel
            </Button>
            <Button loading={payingAll} onClick={paySelected} data-testid="bulk-confirm">
              Pay {selected.size} privately
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <dl className="rounded-lg border border-border bg-bg px-4 py-3 text-sm">
            <Row label="Invoices" value={String(selected.size)} />
            <Row label="Total" value={masked ? "••••••" : <Amount minor={selectedTotal} code="USDC" />} />
            <Row label="Network fee" value={<span className="text-success">Free</span>} />
          </dl>
          {someNeedApproval ? (
            <p className="t-helper">Invoices over your approval limit route to Approvals before they settle.</p>
          ) : null}
          <PrivacyDisclosure hidden={["Amount", "Recipient"]} />
        </div>
      </Modal>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 first:pt-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );
}
