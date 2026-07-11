import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Pause, Play, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  CreatePayrollRunResponse,
  PayrollProgressCounts,
  PayrollRunItem,
  PayrollRunResponse,
  PayrollRunStatus,
  PayrollToken,
  TreasuryUnderfundedError,
} from "@benzo/types";
import { api, isTreasuryUnderfundedError, type PayrollProgressSubscription } from "../lib/api";
import { formatAddress, friendlyError } from "../lib/format";
import { useConsole } from "../lib/store";
import { Screen } from "../ui/motion";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from "../ui/primitives";

const PAYROLL_RUN_KEY_PREFIX = "benzo.console.payroll.currentRun";
const DEFAULT_CSV = "recipient,amount\n@aisha,8500\n@diego,6200\n@priya,9000";

const TOKEN_LABEL: Record<PayrollToken, string> = {
  usdc: "USDC",
  eurc: "EURC",
};

function storageKey(orgId: string): string {
  return `${PAYROLL_RUN_KEY_PREFIX}:${orgId}`;
}

function terminalStatus(status?: PayrollRunStatus): boolean {
  return status === "complete" || status === "failed";
}

function progressFromValidation(validation: CreatePayrollRunResponse | null): PayrollProgressCounts | null {
  if (!validation) return null;
  return {
    total: validation.summary.total,
    pending: validation.summary.valid,
    proving: 0,
    submitted: 0,
    confirmed: 0,
    failed: validation.summary.invalid,
    proved: 0,
  };
}

function summaryFromRun(runState: PayrollRunResponse | null): CreatePayrollRunResponse["summary"] | null {
  if (!runState) return null;
  const invalid = runState.items.filter((item) => item.status === "failed").length;
  return {
    total: runState.run.itemCount,
    valid: Math.max(0, runState.run.itemCount - invalid),
    invalid,
    totalAmount: runState.run.totalAmount,
    token: runState.run.token,
    tokenId: runState.run.tokenId,
  };
}

function parseTokenAmount(value: string): bigint {
  const clean = value.trim().replace(/,/g, "");
  const [whole = "0", frac = ""] = clean.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6) || "0");
}

function formatTokenAmount(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

function underfundedShortfall(body: TreasuryUnderfundedError): string | null {
  try {
    const diff = parseTokenAmount(body.requiredAmount) - parseTokenAmount(body.availableAmount);
    return diff > 0n ? formatTokenAmount(diff) : null;
  } catch {
    return null;
  }
}

function amountLabel(amount: string, token: PayrollToken, masked = false): string {
  return masked ? "••••" : `${amount} ${TOKEN_LABEL[token]}`;
}

function currentStatus(runState: PayrollRunResponse | null, validation: CreatePayrollRunResponse | null): PayrollRunStatus | null {
  return runState?.run.status ?? validation?.status ?? null;
}

function currentRunId(runState: PayrollRunResponse | null, validation: CreatePayrollRunResponse | null): string | null {
  return runState?.run.id ?? validation?.runId ?? null;
}

function updateRunState(
  current: PayrollRunResponse | null,
  status: PayrollRunStatus,
  progress: PayrollProgressCounts,
): PayrollRunResponse | null {
  if (!current) return current;
  return {
    ...current,
    run: { ...current.run, status, updatedAt: new Date().toISOString() },
    progress,
  };
}

export function Payroll() {
  const toast = useToast();
  const { session, masked } = useConsole();
  const activeOrg = session?.activeOrg ?? null;
  const activeOrgId = activeOrg?.id ?? null;

  const [csv, setCsv] = useState(DEFAULT_CSV);
  const [token, setToken] = useState<PayrollToken>("usdc");
  const [rowRecipient, setRowRecipient] = useState("");
  const [rowAmount, setRowAmount] = useState("");
  const [validation, setValidation] = useState<CreatePayrollRunResponse | null>(null);
  const [runState, setRunState] = useState<PayrollRunResponse | null>(null);
  const [underfunded, setUnderfunded] = useState<TreasuryUnderfundedError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const subscriptionRef = useRef<PayrollProgressSubscription | null>(null);

  const runId = currentRunId(runState, validation);
  const status = currentStatus(runState, validation);
  const summary = validation?.summary ?? summaryFromRun(runState);
  const items = runState?.items ?? validation?.items ?? [];
  const progress = runState?.progress ?? progressFromValidation(validation);
  const displayToken = summary?.token ?? token;
  const canStart = !!runId && status === "ready" && (summary?.invalid ?? 0) === 0;
  const canPause = !!runId && status === "running";
  const canResume = !!runId && status === "paused";

  const closeSubscription = useCallback(() => {
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
  }, []);

  const hydrateRun = useCallback(async (id: string, silent = false) => {
    if (!silent) setHydrating(true);
    try {
      const next = await api.getPayrollRun(id);
      setRunState(next);
      setValidation(null);
      setToken(next.run.token);
      setError(null);
      return next;
    } catch (e) {
      const msg = friendlyError(e, "Could not load this payroll run.");
      setError(msg);
      if (!silent) toast({ title: msg, tone: "danger" });
      return null;
    } finally {
      if (!silent) setHydrating(false);
    }
  }, [toast]);

  useEffect(() => {
    closeSubscription();
    setValidation(null);
    setRunState(null);
    setUnderfunded(null);
    setError(null);
    if (!activeOrgId) return undefined;
    const stored = localStorage.getItem(storageKey(activeOrgId));
    if (stored) void hydrateRun(stored);
    return closeSubscription;
  }, [activeOrgId, closeSubscription, hydrateRun]);

  useEffect(() => {
    closeSubscription();
    if (!runId || status !== "running") return closeSubscription;
    subscriptionRef.current = api.subscribePayrollProgress(
      runId,
      (event) => {
        setRunState((current) => updateRunState(current, event.status, event.progress));
        if (terminalStatus(event.status)) void hydrateRun(runId, true);
      },
      (e) => setError(friendlyError(e, "Could not update payroll progress.")),
    );
    return closeSubscription;
  }, [runId, status, closeSubscription, hydrateRun]);

  const addRow = useCallback(() => {
    const recipient = rowRecipient.trim();
    const amount = rowAmount.trim();
    if (!recipient || !amount) return;
    setCsv((current) => {
      const trimmed = current.trim();
      const prefix = trimmed ? `${trimmed}\n` : "recipient,amount\n";
      return `${prefix}${recipient},${amount}`;
    });
    setRowRecipient("");
    setRowAmount("");
  }, [rowAmount, rowRecipient]);

  const validateRun = useCallback(async () => {
    if (!activeOrgId) return;
    setValidating(true);
    setUnderfunded(null);
    setError(null);
    setRunState(null);
    closeSubscription();
    try {
      const created = await api.createPayrollRun(activeOrgId, { csv, token });
      setValidation(created);
      setToken(created.token);
      localStorage.setItem(storageKey(activeOrgId), created.runId);
      toast({
        title: created.status === "ready"
          ? `Validated ${created.summary.valid} row${created.summary.valid === 1 ? "" : "s"}`
          : `Validation found ${created.summary.invalid} issue${created.summary.invalid === 1 ? "" : "s"}`,
        tone: created.status === "ready" ? "success" : "danger",
      });
      void hydrateRun(created.runId, true);
    } catch (e) {
      const msg = friendlyError(e, "Could not validate this payroll CSV.");
      setError(msg);
      toast({ title: msg, tone: "danger" });
    } finally {
      setValidating(false);
    }
  }, [activeOrgId, closeSubscription, csv, hydrateRun, toast, token]);

  const startRun = useCallback(async () => {
    if (!runId) return;
    setStarting(true);
    setUnderfunded(null);
    setError(null);
    try {
      const started = await api.startPayrollRun(runId);
      setRunState((current) => updateRunState(current, started.status, started.progress));
      if (!runState) void hydrateRun(runId, true);
      toast({ title: `Payroll started · ${started.totalPending} pending`, tone: "success" });
    } catch (e) {
      if (isTreasuryUnderfundedError(e)) {
        setUnderfunded(e.body);
        setError(null);
      } else {
        const msg = friendlyError(e, "Could not start this payroll run.");
        setError(msg);
        toast({ title: msg, tone: "danger" });
      }
    } finally {
      setStarting(false);
    }
  }, [hydrateRun, runId, runState, toast]);

  const pauseRun = useCallback(async () => {
    if (!runId) return;
    setPausing(true);
    try {
      const paused = await api.pausePayrollRun(runId);
      closeSubscription();
      setRunState((current) => updateRunState(current, paused.status, paused.progress));
      toast({ title: "Payroll paused", tone: "warning" });
    } catch (e) {
      const msg = friendlyError(e, "Could not pause this payroll run.");
      setError(msg);
      toast({ title: msg, tone: "danger" });
    } finally {
      setPausing(false);
    }
  }, [closeSubscription, runId, toast]);

  const resumeRun = useCallback(async () => {
    if (!runId) return;
    setResuming(true);
    setUnderfunded(null);
    try {
      const resumed = await api.resumePayrollRun(runId);
      setRunState((current) => updateRunState(current, resumed.status, resumed.progress));
      toast({ title: `Payroll resumed · ${resumed.totalPending} pending`, tone: "success" });
    } catch (e) {
      if (isTreasuryUnderfundedError(e)) {
        setUnderfunded(e.body);
        setError(null);
      } else {
        const msg = friendlyError(e, "Could not resume this payroll run.");
        setError(msg);
        toast({ title: msg, tone: "danger" });
      }
    } finally {
      setResuming(false);
    }
  }, [runId, toast]);

  const runLabel = useMemo(() => {
    if (!runId) return "No run yet";
    return `Run ${runId.slice(0, 10)}${runId.length > 10 ? "..." : ""}`;
  }, [runId]);

  return (
    <Screen>
      <PageHeader
        title="Payroll"
        subtitle="CSV payroll, server-side proving, live encrypted settlement progress"
        action={status ? <StatusPill status={status} /> : null}
      />

      {!activeOrg ? (
        <EmptyState title="No active organization" hint="Choose or create an organization before running payroll." />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <Card className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="t-card-title text-fg">Compose CSV</div>
                  <p className="t-helper mt-1">Rows use recipient handle or address, then decimal amount.</p>
                </div>
                <Select
                  aria-label="Payroll token"
                  value={token}
                  onChange={(e) => setToken(e.currentTarget.value as PayrollToken)}
                  className="w-32"
                  data-testid="payroll-token"
                >
                  <option value="usdc">USDC</option>
                  <option value="eurc">EURC</option>
                </Select>
              </div>

              <Textarea
                value={csv}
                onChange={(e) => setCsv(e.currentTarget.value)}
                className="min-h-[180px] font-mono text-[13px]"
                spellCheck={false}
                data-testid="payroll-csv"
                aria-label="Payroll CSV"
              />

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                <Input
                  placeholder="@handle or 0x..."
                  value={rowRecipient}
                  onChange={(e) => setRowRecipient(e.currentTarget.value)}
                  aria-label="Recipient"
                />
                <Input
                  placeholder="Amount"
                  inputMode="decimal"
                  value={rowAmount}
                  onChange={(e) => setRowAmount(e.currentTarget.value.replace(/[^0-9.]/g, ""))}
                  aria-label="Amount"
                />
                <Button variant="outline" onClick={addRow} disabled={!rowRecipient.trim() || !rowAmount.trim()} data-testid="add-payroll-row">
                  <Plus size={15} /> Add row
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="inline-flex items-center gap-2 text-[13px] text-muted">
                  <ShieldCheck size={14} className="text-primary" />
                  Proving is sequential and server-side after the run starts.
                </div>
                <Button onClick={validateRun} loading={validating} disabled={!csv.trim()} data-testid="validate-payroll">
                  <CheckCircle2 size={15} /> Validate
                </Button>
              </div>
            </Card>

            <Card className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="t-card-title text-fg">{runLabel}</div>
                  <p className="t-helper mt-1">
                    {runState ? `Updated ${new Date(runState.run.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Validate a CSV to create a run."}
                  </p>
                </div>
                {hydrating ? <Skeleton className="h-7 w-20" /> : status ? <StatusPill status={status} /> : null}
              </div>

              {summary ? (
                <div className="grid grid-cols-2 gap-2">
                  <Fact label="Rows" value={summary.total} />
                  <Fact label="Valid" value={summary.valid} />
                  <Fact label="Invalid" value={summary.invalid} danger={summary.invalid > 0} />
                  <Fact label="Total" value={amountLabel(summary.totalAmount, summary.token, masked)} />
                </div>
              ) : (
                <p className="text-sm text-muted">The backend returns a validation summary before anything is enqueued.</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={startRun} loading={starting} disabled={!canStart} data-testid="start-payroll">
                  <Play size={15} /> Start
                </Button>
                <Button variant="outline" onClick={pauseRun} loading={pausing} disabled={!canPause} data-testid="pause-payroll">
                  <Pause size={15} /> Pause
                </Button>
                <Button variant="outline" onClick={resumeRun} loading={resuming} disabled={!canResume} data-testid="resume-payroll">
                  <RefreshCw size={15} /> Resume
                </Button>
              </div>
            </Card>
          </div>

          {underfunded ? <UnderfundedAlert body={underfunded} /> : null}
          {error ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger" data-testid="payroll-error">
              {error}
            </div>
          ) : null}

          {progress ? <ProgressPanel progress={progress} status={status} /> : null}

          {items.length > 0 ? (
            <ItemsTable items={items} token={displayToken} masked={masked} />
          ) : (
            <EmptyState title="No payroll run composed" hint="Paste CSV rows, validate them, then start live progress." />
          )}
        </div>
      )}
    </Screen>
  );
}

function Fact({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="border-l border-border pl-3">
      <div className="t-label text-muted">{label}</div>
      <div className={`mt-0.5 text-[14px] font-semibold ${danger ? "text-danger" : "text-fg"}`}>{value}</div>
    </div>
  );
}

function UnderfundedAlert({ body }: { body: TreasuryUnderfundedError }) {
  const shortfall = underfundedShortfall(body);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between" data-testid="underfunded-alert">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 flex-none" />
        <div>
          <div className="font-semibold">Treasury underfunded</div>
          <div className="mt-0.5">
            Required {body.requiredAmount} {TOKEN_LABEL[body.token]}, available {body.availableAmount} {TOKEN_LABEL[body.token]}
            {shortfall ? `, short by ${shortfall} ${TOKEN_LABEL[body.token]}` : ""}.
          </div>
        </div>
      </div>
      <Link to="/treasury" className="inline-flex flex-none items-center justify-center rounded-lg border border-warning/40 px-3 py-2 text-sm font-medium outline-none transition hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-warning/40">
        Fund treasury
      </Link>
    </div>
  );
}

function ProgressPanel({ progress, status }: { progress: PayrollProgressCounts; status: PayrollRunStatus | null }) {
  const total = Math.max(1, progress.total);
  const confirmedPct = Math.min(100, Math.round((progress.confirmed / total) * 100));
  const terminal = terminalStatus(status ?? undefined);
  return (
    <Card className="space-y-4" data-testid="payroll-progress">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="t-card-title text-fg">Live progress</div>
          <p className="t-helper mt-1">Pending to proving to submitted to confirmed.</p>
        </div>
        {status ? <StatusPill status={status} /> : null}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${terminal && progress.failed > 0 ? "bg-danger" : "bg-success"}`} style={{ width: `${confirmedPct}%` }} />
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <ProgressCount label="Pending" value={progress.pending} total={progress.total} />
        <ProgressCount label="Proving" value={progress.proving} total={progress.total} />
        <ProgressCount label="Submitted" value={progress.submitted} total={progress.total} />
        <ProgressCount label="Confirmed" value={progress.confirmed} total={progress.total} testId="progress-confirmed" />
      </div>
      <div className="flex flex-wrap gap-4 text-[13px] text-muted">
        <span>Failed: <b className={progress.failed ? "text-danger" : "text-fg"}>{progress.failed}</b></span>
        <span>Proved: <b className="text-fg">{progress.proved}</b></span>
      </div>
    </Card>
  );
}

function ProgressCount({ label, value, total, testId }: { label: string; value: number; total: number; testId?: string }) {
  return (
    <div className="border-l border-border pl-3" data-testid={testId}>
      <div className="t-label text-muted">{label}</div>
      <div className="mt-1 text-[18px] font-semibold text-fg">{value}<span className="text-sm font-medium text-muted">/{total}</span></div>
    </div>
  );
}

function ItemsTable({ items, token, masked }: { items: PayrollRunItem[]; token: PayrollToken; masked: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Row</Th>
          <Th>Recipient</Th>
          <Th>Resolved</Th>
          <Th>Status</Th>
          <Th align="right">Amount</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <Tr key={`${item.rowIndex}-${item.recipientInput}`} data-testid={`payroll-row-${item.rowIndex}`}>
            <Td className="tnum text-muted">{item.rowIndex}</Td>
            <Td>
              <div className="font-medium text-fg">{item.recipientInput}</div>
              {item.error ? <div className="t-helper mt-0.5 text-danger">{item.error}</div> : null}
            </Td>
            <Td>{item.resolvedAddress ? <span className="font-mono text-xs">{formatAddress(item.resolvedAddress, 6, 4)}</span> : <span className="text-muted">-</span>}</Td>
            <Td><StatusPill status={item.status} /></Td>
            <Td align="right" className="tnum">{amountLabel(item.amount, token, masked)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
