/**
 * Contractors - the roster + rate cards that the pay engine COMPUTES runs from.
 * This is the input to every payroll run: a managed payee book with a monthly USDC
 * rate per contractor, CSV import, single-row add, and inline rate/handle edits. Run
 * amounts are computed server-side from these rates (never typed in) — surfaced as the
 * info note beside the payroll total, not as page chrome.
 */
import { Fragment, useMemo, useState } from "react";
import { Check, Clock, Info, Plus, Upload } from "lucide-react";
import type { Counterparty } from "@benzo/types";
import { api } from "../lib/api";
import { useConsole } from "../lib/store";
import { explorerTxUrl, friendlyError, initials, minorToUsdc, usdcToMinor } from "../lib/format";
import { EASE, Screen, Stagger, motion } from "../ui/motion";
import {
  Amount, Button, Card, EmptyState, Input, MetaPill, Modal, PageHeader, Pill,
  Skeleton, Stat, StatusPill, Table, Tabs, Td, Th, useToast,
} from "../ui/primitives";

type PayEvent = { period: string; amount: string; status: string; txHash?: string; batchId: string };
type Filter = "all" | "active" | "review";

const statuses: Counterparty["status"][] = ["draft", "invited", "pending_screening", "allowlisted", "blocked"];

export function Contractors() {
  const toast = useToast();
  const { counterparties, loading, refresh } = useConsole();
  const [filter, setFilter] = useState<Filter>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [importErrors, setImportErrors] = useState<Array<{ line: number; error: string }>>([]);
  const [add, setAdd] = useState({ name: "", handle: "", rate: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [handleEdits, setHandleEdits] = useState<Record<string, string>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState<string | null>(null);
  const [hist, setHist] = useState<Record<string, PayEvent[]>>({});
  const [histBusy, setHistBusy] = useState<string | null>(null);

  const contractors = useMemo(() => counterparties.filter((c) => c.type === "contractor"), [counterparties]);
  // Two distinct axes: an ACTIVE contractor is allowlisted (payable); IN REVIEW is
  // still being screened. The header stat used to say "5" while six rows showed — the
  // 6th is in review, not active. These counts keep that split honest.
  const active = useMemo(() => contractors.filter((c) => c.status === "allowlisted"), [contractors]);
  const inReview = useMemo(() => contractors.filter((c) => c.status === "pending_screening"), [contractors]);
  const payable = useMemo(() => active.filter((c) => c.payRate), [active]);
  const monthlyTotal = useMemo(
    () => payable.reduce((s, c) => s + BigInt(c.payRate?.amount ?? "0"), 0n).toString(),
    [payable],
  );
  const rows = filter === "active" ? active : filter === "review" ? inReview : contractors;

  async function toggleHistory(c: Counterparty) {
    if (histOpen === c.id) return setHistOpen(null);
    setHistOpen(c.id);
    if (hist[c.id]) return;
    setHistBusy(c.id);
    try {
      const r = await api.contractorHistory(c.id);
      setHist((m) => ({ ...m, [c.id]: r }));
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setHistBusy(null);
    }
  }

  async function doImport() {
    setBusy("import");
    try {
      const r = await api.importRoster(csv);
      setImportErrors(r.errors);
      toast({
        title: `Imported ${r.imported} contractor${r.imported === 1 ? "" : "s"}${r.errors.length ? ` · ${r.errors.length} row error(s)` : ""}`,
        tone: r.errors.length ? "danger" : "success",
      });
      if (r.errors.length === 0) {
        setImportOpen(false);
        setCsv("");
      }
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  // Single-row add reuses the roster import path — same server-side validation, so a
  // quick add and a bulk import can't diverge.
  async function doAdd() {
    const name = add.name.trim();
    const handle = add.handle.trim();
    const rate = add.rate.trim();
    if (!name || !rate) return;
    setAddError(null);
    setBusy("add");
    try {
      const r = await api.importRoster(`${name},${handle},${rate}`);
      if (r.errors.length) {
        setAddError(r.errors[0]?.error ?? "Check the name and monthly rate.");
        toast({ title: "Couldn't add contractor", tone: "danger" });
        return;
      }
      toast({ title: `Added ${name}`, tone: "success" });
      setAddOpen(false);
      setAdd({ name: "", handle: "", rate: "" });
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  function flash(id: string) {
    setSavedFlash(id);
    setTimeout(() => setSavedFlash((x) => (x === id ? null : x)), 900);
  }

  async function saveRate(c: Counterparty) {
    const human = rateEdits[c.id];
    if (human === undefined) return;
    setBusy(c.id);
    try {
      await api.updateCounterparty(c.id, { payRate: usdcToMinor(human) });
      toast({ title: `Rate updated for ${c.name}`, tone: "success" });
      flash(c.id);
      setRateEdits((m) => {
        const n = { ...m };
        delete n[c.id];
        return n;
      });
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function saveHandle(c: Counterparty) {
    const handle = handleEdits[c.id]?.trim();
    if (!handle) return;
    setBusy(c.id);
    try {
      await api.updateCounterparty(c.id, { handle: handle.startsWith("@") ? handle : `@${handle}` });
      toast({ title: `Handle updated for ${c.name}`, tone: "success" });
      flash(c.id);
      setHandleEdits((m) => {
        const n = { ...m };
        delete n[c.id];
        return n;
      });
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function saveStatus(c: Counterparty, status: Counterparty["status"]) {
    if (status === c.status) return;
    setBusy(c.id);
    try {
      await api.updateCounterparty(c.id, { status });
      toast({ title: `Payment access updated for ${c.name}`, tone: "success" });
      flash(c.id);
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <PageHeader
        title="Contractors"
        subtitle="Manage contractor profiles, rate cards, tax forms, and payment access."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="import-roster">
              <Upload size={15} /> Import CSV
            </Button>
            <Button onClick={() => setAddOpen(true)} data-testid="add-contractor">
              <Plus size={15} /> Add contractor
            </Button>
          </div>
        }
      />

      <Stagger className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stagger.Item index={0}>
          <Stat label="Active contractors" value={active.length} hint="Allowlisted & payable" />
        </Stagger.Item>
        <Stagger.Item index={1}>
          <Stat label="In review" value={inReview.length} hint="Awaiting screening" />
        </Stagger.Item>
        <Stagger.Item index={2}>
          <Stat
            label="Active monthly payroll"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Amount minor={monthlyTotal} code="USDC" />
                <span
                  className="cursor-help text-muted transition hover:text-fg"
                  title="Computed from each contractor's rate card on the server — amounts are never typed into a run."
                  aria-label="How this total is computed"
                >
                  <Info size={14} />
                </span>
              </span>
            }
            hint={`${payable.length} active rate card${payable.length === 1 ? "" : "s"}`}
          />
        </Stagger.Item>
      </Stagger>

      <div className="mb-3">
        <Tabs<Filter>
          active={filter}
          onChange={setFilter}
          items={[
            { id: "all", label: `All ${contractors.length}` },
            { id: "active", label: `Active ${active.length}` },
            { id: "review", label: `In review ${inReview.length}` },
          ]}
        />
      </div>

      {loading ? (
        <Card className="p-0">
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      ) : contractors.length === 0 ? (
        <EmptyState title="No contractors yet" hint="Add a contractor or import a CSV (name, @handle, monthly USDC) to load your roster." />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here" hint="No contractors match this filter." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Contractor</Th>
              <Th align="right">Monthly rate</Th>
              <Th>Handle</Th>
              <Th>Tax form</Th>
              <Th>Verification</Th>
              <Th>Payment access</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const editing = rateEdits[c.id] !== undefined;
              const editingHandle = handleEdits[c.id] !== undefined;
              const events = hist[c.id];
              const hasTax = c.taxFormType && c.taxFormType !== "none";
              const flashBg = savedFlash === c.id ? "rgba(34,197,94,0.16)" : "rgba(34,197,94,0)";
              return (
                <Fragment key={c.id}>
                  <tr className="transition-colors hover:bg-border/25" data-testid="contractor-row">
                    {/* Contractor */}
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-border/60 text-[11px] font-semibold text-muted">
                          {initials(c.name)}
                        </span>
                        <span className="block max-w-[200px] truncate font-medium text-fg">{c.name}</span>
                      </div>
                    </Td>

                    {/* Monthly rate — tight tabular, right-aligned, click to edit */}
                    <Td align="right">
                      <motion.div
                        className="-mx-2 inline-block rounded-md px-2"
                        animate={{ backgroundColor: flashBg }}
                        transition={{ duration: 0.45, ease: EASE }}
                      >
                        {editing ? (
                          <input
                            autoFocus
                            value={rateEdits[c.id]}
                            onChange={(e) => setRateEdits((m) => ({ ...m, [c.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                            onKeyDown={(e) => e.key === "Enter" && saveRate(c)}
                            onBlur={() => saveRate(c)}
                            data-testid="contractor-rate-input"
                            className="w-28 rounded-md border border-primary bg-bg px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        ) : (
                          <button
                            className="tnum rounded text-fg outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                            onClick={() => setRateEdits((m) => ({ ...m, [c.id]: c.payRate ? minorToUsdc(c.payRate.amount) : "" }))}
                            title="Click to edit rate"
                            data-testid="contractor-rate-edit"
                          >
                            {c.payRate ? <Amount minor={c.payRate.amount} tabular /> : <span className="text-warning">Set rate</span>}
                          </button>
                        )}
                      </motion.div>
                    </Td>

                    {/* Handle */}
                    <Td>
                      <motion.div
                        className="-mx-2 inline-flex items-center gap-1 rounded-md px-2"
                        animate={{ backgroundColor: flashBg }}
                        transition={{ duration: 0.45, ease: EASE }}
                      >
                        {editingHandle ? (
                          <>
                            <input
                              autoFocus
                              value={handleEdits[c.id]}
                              onChange={(e) => setHandleEdits((m) => ({ ...m, [c.id]: e.target.value.replace(/[^a-zA-Z0-9_@.-]/g, "") }))}
                              onKeyDown={(e) => e.key === "Enter" && saveHandle(c)}
                              data-testid="contractor-handle-input"
                              className="w-32 rounded-md border border-primary bg-bg px-2 py-1 font-mono text-[12px] outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <button
                              onClick={() => saveHandle(c)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-muted transition hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                              title="Save handle"
                              data-testid="contractor-handle-save"
                            >
                              <Check size={14} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="rounded outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40"
                            onClick={() => setHandleEdits((m) => ({ ...m, [c.id]: c.paymentAddress?.shielded ?? "@" }))}
                            title="Click to edit handle"
                            data-testid="contractor-handle-edit"
                          >
                            {c.paymentAddress?.shielded ? (
                              <span className="font-mono text-[12px] text-fg transition hover:text-primary">{c.paymentAddress.shielded}</span>
                            ) : (
                              <span className="text-[13px] font-medium text-warning transition hover:underline">Add handle</span>
                            )}
                          </button>
                        )}
                      </motion.div>
                    </Td>

                    {/* Tax form — neutral MetaPill; missing = amber (incomplete, not a failure) */}
                    <Td>
                      {hasTax ? <MetaPill>{c.taxFormType}</MetaPill> : <Pill tone="warning">Missing</Pill>}
                    </Td>

                    {/* Verification — compact lifecycle badge (screening outcome) */}
                    <Td>
                      <StatusPill status={c.status} />
                    </Td>

                    {/* Payment access — the allowlist control (separate axis from verification) */}
                    <Td>
                      <select
                        value={c.status}
                        onChange={(e) => saveStatus(c, e.target.value as Counterparty["status"])}
                        className="w-full max-w-[150px] rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-fg outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                        data-testid="contractor-status-select"
                      >
                        {statuses.map((s) => (
                          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </Td>

                    {/* Actions */}
                    <Td align="right">
                      {busy === c.id ? (
                        <span className="text-[12px] text-muted">Saving…</span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => toggleHistory(c)} data-testid="contractor-history">
                          <Clock size={13} /> {histOpen === c.id ? "Hide" : "History"}
                        </Button>
                      )}
                    </Td>
                  </tr>

                  {histOpen === c.id ? (
                    <tr data-testid="contractor-history-row">
                      <td colSpan={7} className="border-t border-border bg-bg/70 px-4 py-3">
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                          {histBusy === c.id ? (
                            <div className="t-helper">Loading pay history…</div>
                          ) : !events || events.length === 0 ? (
                            <div className="t-helper">No payments to {c.name} yet. Runs that include them will show here with on-chain receipts.</div>
                          ) : (
                            <div className="space-y-1.5">
                              {events.map((e, ei) => (
                                <div key={ei} className="flex items-center gap-3 text-[12.5px]">
                                  <span className="w-20 font-medium text-fg">{e.period}</span>
                                  <StatusPill status={e.status} />
                                  {e.txHash ? (
                                    <a href={explorerTxUrl(e.txHash)} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-primary hover:underline">on-chain receipt</a>
                                  ) : null}
                                  <span className="ml-auto"><Amount minor={e.amount} tabular /></span>
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* Add contractor */}
      <Modal
        open={addOpen}
        onClose={() => {
          setAddError(null);
          setAddOpen(false);
        }}
        title="Add contractor"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAddError(null);
                setAddOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button loading={busy === "add"} onClick={doAdd} disabled={!add.name.trim() || !add.rate.trim()} data-testid="add-submit">
              <Plus size={15} /> Add contractor
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            value={add.name}
            onChange={(e) => setAdd((a) => ({ ...a, name: e.target.value }))}
            placeholder="Jane Doe"
            data-testid="add-name"
          />
          <Input
            label="Handle"
            hint="Optional. Their Benzo handle for private payouts — you can add it later."
            value={add.handle}
            onChange={(e) => setAdd((a) => ({ ...a, handle: e.target.value.replace(/[^a-zA-Z0-9_@.-]/g, "") }))}
            placeholder="@jane"
            data-testid="add-handle"
          />
          <Input
            label="Monthly rate (USDC)"
            hint="The rate card each payroll run is computed from — never typed into a run."
            value={add.rate}
            onChange={(e) => setAdd((a) => ({ ...a, rate: e.target.value.replace(/[^0-9.]/g, "") }))}
            placeholder="8500"
            inputMode="decimal"
            data-testid="add-rate"
          />
          {addError ? (
            <div className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-[12.5px] text-danger" data-testid="add-error">
              {addError}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Import roster */}
      <Modal
        open={importOpen}
        onClose={() => {
          setImportErrors([]);
          setImportOpen(false);
        }}
        title="Import contractor roster"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setImportErrors([]);
                setImportOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button loading={busy === "import"} onClick={doImport} disabled={!csv.trim()} data-testid="import-submit"><Upload size={15} /> Import</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="t-helper">Paste CSV: <code className="rounded bg-bg px-1">name, @handle, monthly USDC</code>. Bad rows are flagged, never silently dropped.</div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"Name,Handle,Monthly USDC"}
            rows={7}
            data-testid="import-csv"
            className="w-full rounded-lg border border-border bg-bg p-3 font-mono text-[12.5px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {importErrors.length ? (
            <div className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-[12.5px] text-danger" data-testid="import-errors">
              <div className="mb-1 font-semibold">Fix these rows, then import again.</div>
              <ul className="space-y-1">
                {importErrors.map((err, idx) => (
                  <li key={`${err.line}-${idx}`}>Line {err.line}: {err.error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Modal>
    </Screen>
  );
}
