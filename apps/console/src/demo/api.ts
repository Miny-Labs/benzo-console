/**
 * Demo api — a drop-in for the real typed `api` client that resolves every read
 * against a seeded in-memory org and every write against a mutable copy of it, on
 * realistic timers, with NO network. Swapped in at build time by `VITE_DEMO_MODE=1`
 * (see ../lib/api.ts). Writes mutate the shared `db`, and prove/settle flows return
 * on-chain-shaped success so the shared SendCeremony cinematics play end-to-end and
 * land on a fake-but-believable receipt (txHash + Merkle root + verifier ref).
 */
import type {
  Counterparty,
  CreateOrgResponse,
  DepositToTreasuryRequest,
  DepositToTreasuryResponse,
  Invoice,
  OnboardingStatus,
  OnboardingStatusResponse,
  PaymentOrder,
  CreatePayrollRunRequest,
  CreatePayrollRunResponse,
  PayrollProgressCounts,
  PayrollRun,
  PayrollRunItem,
  PayrollRunResponse,
  PayrollToken,
  PausePayrollRunResponse,
  ProvisionTreasuryResponse,
  ResumePayrollRunResponse,
  StartPayrollRunResponse,
  StartOnboardingResponse,
  TreasuryDepositsResponse,
  ViewingGrant,
} from "@benzo/types";
import type {
  ApprovalProgressView,
  OnChainRef,
  OrgInvite,
  PrivateAuditAnchorResponse,
  PrivateAuditPacketResponse,
  RecoveryStatus,
} from "../lib/api";
import { explorerTxUrl } from "../lib/format";
import { NETWORK } from "../lib/network";
import { createDemoDb, dashboardSummary, treasuryView, usd } from "./data";

// PURE-annotated so a normal build (DEMO_MODE folds to false → demoApi unused)
// tree-shakes the entire demo graph away, leaving the production bundle unchanged.
const db = /* @__PURE__ */ createDemoDb();
let demoMockKyc: { name?: string; country?: string } | undefined;

// ---- fake-chain helpers ---------------------------------------------------
function randHex(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  // Fallback must fill `bytes` IN PLACE — `.map()` returns a fresh array that
  // would be discarded, leaving `bytes` all-zeros (identical output every call).
  const rng = globalThis.crypto ?? {
    getRandomValues: (a: Uint8Array) => {
      for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0;
      return a;
    },
  };
  rng.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}
const fakeTx = () => `0x${randHex(64)}`;
const fakeRoot = () => `0x${randHex(64)}`;
const fakeVerifier = () => `0x${randHex(40)}`;
const now = () => new Date().toISOString();
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A verified on-chain reference the drill-down modals + receipts can re-render. */
function fakeRef(label: string, vkId: string, publics: Array<{ k: string; v: string }> = []): OnChainRef {
  return { label, vkId, verified: true, verifier: fakeVerifier(), network: NETWORK, txHash: fakeTx(), root: fakeRoot(), publics };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const byId = <T extends { id: string }>(arr: T[], id: string) => arr.find((x) => x.id === id);

// Latency profiles: reads snappy, proof/settle steps long enough to feel real
// (the roster/`proving` strip animates during these awaits before the ceremony
// floors walk encrypt -> settle -> verify).
const READ = 140;
const PROVE = 640;
const SETTLE = 720;
const ONBOARDING_STEP = 520;
const PAYROLL_STEP = 420;

const TOKEN_ID: Record<PayrollToken, string> = {
  usdc: "avalanche-fuji:usdc",
  eurc: "avalanche-fuji:eurc",
};

const payrollTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();

function activeOrg() {
  const org = db.session.activeOrg;
  if (!org) throw new Error("No demo org");
  return org;
}

function parseTokenAmount(value: string): bigint {
  const clean = value.trim().replace(/,/g, "");
  const [whole = "0", frac = ""] = clean.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6) || "0");
}

function formatTokenAmount(minor: bigint): string {
  const whole = minor / 1_000_000n;
  const frac = (minor % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}`;
}

function normalizePayrollAmount(raw: string): string | null {
  const value = raw.trim().replace(/,/g, "");
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) return null;
  if (parseTokenAmount(value) <= 0n) return null;
  return formatTokenAmount(parseTokenAmount(value));
}

function resolvePayrollRecipient(input: string): string | null {
  const recipient = input.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(recipient)) return recipient;
  const match = db.counterparties.find((c) => c.paymentAddress?.shielded?.toLowerCase() === recipient.toLowerCase());
  return match?.paymentAddress?.spendPub ?? null;
}

function payrollProgress(items: PayrollRunItem[]): PayrollProgressCounts {
  const confirmed = items.filter((item) => item.status === "confirmed").length;
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    proving: items.filter((item) => item.status === "proving").length,
    submitted: items.filter((item) => item.status === "submitted").length,
    confirmed,
    failed: items.filter((item) => item.status === "failed").length,
    proved: confirmed,
  };
}

function clearPayrollTimers(runId: string) {
  for (const timer of payrollTimers.get(runId) ?? []) clearTimeout(timer);
  payrollTimers.delete(runId);
}

function payrollSnapshot(runId: string): PayrollRunResponse {
  const run = byId(db.payrollRuns, runId);
  if (!run) throw new Error("not found");
  return {
    run: clone(run),
    progress: clone(db.payrollProgress[runId] ?? payrollProgress(db.payrollItems[runId] ?? [])),
    items: clone(db.payrollItems[runId] ?? []),
  };
}

function setPayrollItemStatus(runId: string, rowIndex: number, status: PayrollRunItem["status"]) {
  const run = byId(db.payrollRuns, runId);
  if (!run || run.status !== "running") return;
  const item = (db.payrollItems[runId] ?? []).find((i) => i.rowIndex === rowIndex);
  if (!item || item.status === "failed" || item.status === "confirmed") return;
  item.status = status;
  run.updatedAt = now();
  db.payrollProgress[runId] = payrollProgress(db.payrollItems[runId] ?? []);
  if (db.payrollProgress[runId].confirmed + db.payrollProgress[runId].failed >= db.payrollProgress[runId].total) {
    run.status = db.payrollProgress[runId].failed > 0 ? "failed" : "complete";
    run.updatedAt = now();
    if (run.status === "complete") db.privateTotal = (BigInt(db.privateTotal) - parseTokenAmount(run.totalAmount)).toString();
    clearPayrollTimers(runId);
  }
}

function schedulePayrollProgress(runId: string) {
  clearPayrollTimers(runId);
  const run = byId(db.payrollRuns, runId);
  if (!run || run.status !== "running") return;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const remaining = (db.payrollItems[runId] ?? []).filter((item) => item.status !== "confirmed" && item.status !== "failed");
  remaining.forEach((item, index) => {
    const base = index * PAYROLL_STEP * 3;
    timers.push(setTimeout(() => setPayrollItemStatus(runId, item.rowIndex, "proving"), base + PAYROLL_STEP));
    timers.push(setTimeout(() => setPayrollItemStatus(runId, item.rowIndex, "submitted"), base + PAYROLL_STEP * 2));
    timers.push(setTimeout(() => setPayrollItemStatus(runId, item.rowIndex, "confirmed"), base + PAYROLL_STEP * 3));
  });
  payrollTimers.set(runId, timers);
}

function parsePayrollCsv(csv: string, token: PayrollToken): Pick<CreatePayrollRunResponse, "summary" | "items" | "status" | "token" | "tokenId"> {
  const rows = csv.split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), rowIndex: index + 1 }))
    .filter((row) => row.line.length > 0);
  const dataRows = rows[0] && /^recipient\s*,\s*amount/i.test(rows[0].line) ? rows.slice(1) : rows;
  const items = dataRows.map(({ line, rowIndex }) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const [recipientInput = "", rawAmount = ""] = cells;
    const amount = normalizePayrollAmount(rawAmount);
    const resolvedAddress = recipientInput ? resolvePayrollRecipient(recipientInput) : null;
    let error: string | null = null;
    if (cells.length !== 2 || !recipientInput || !rawAmount) error = "Expected recipient,amount.";
    else if (!amount) error = "Amount must be a positive decimal with up to 6 places.";
    else if (!resolvedAddress) error = "Recipient did not resolve to a Benzo handle or address.";
    return {
      rowIndex,
      recipientInput,
      resolvedAddress,
      amount: amount ?? rawAmount,
      status: error ? "failed" as const : "pending" as const,
      error,
    };
  });
  const totalAmount = formatTokenAmount(items.reduce((sum, item) => item.status === "failed" ? sum : sum + parseTokenAmount(item.amount), 0n));
  const invalid = items.filter((item) => item.status === "failed").length;
  return {
    status: invalid > 0 || items.length === 0 ? "failed" : "ready",
    token,
    tokenId: TOKEN_ID[token],
    summary: { total: items.length, valid: items.length - invalid, invalid, totalAmount, token, tokenId: TOKEN_ID[token] },
    items,
  };
}

const ONBOARDING_STATUSES = ["pending_kyc", "kyc_approved", "allowlisted", "gas_dripped", "awaiting_registration", "complete"] as const;

function setDemoOnboardingStatus(status: OnboardingStatus["status"], mockKycPayload?: { name?: string; country?: string }): OnboardingStatus {
  const order = ONBOARDING_STATUSES.indexOf(status as (typeof ONBOARDING_STATUSES)[number]);
  const timestamp = now();
  const kycDone = order >= 1;
  const allowlistDone = order >= 2;
  const gasDone = order >= 3;
  const registrationChecked = order >= 4;
  const registrationDone = order >= 5;
  db.onboardingStatus = {
    ...db.onboardingStatus,
    status,
    error: status === "failed" ? db.onboardingStatus.error ?? "Onboarding failed." : null,
    updatedAt: timestamp,
    mockKyc: kycDone
      ? {
        approvedAt: timestamp,
        payload: mockKycPayload ?? db.onboardingStatus.mockKyc?.payload ?? {},
        provider: "demo",
      }
      : null,
    steps: {
      kyc: { completedAt: kycDone ? timestamp : null, provider: kycDone ? "demo" : null },
      allowlist: { completedAt: allowlistDone ? timestamp : null, result: allowlistDone ? { ok: true } : null, txHash: allowlistDone ? fakeTx() : null },
      gas: { completedAt: gasDone ? timestamp : null, result: gasDone ? { ok: true } : null, txHash: gasDone ? fakeTx() : null },
      registration: { completedAt: registrationDone ? timestamp : null, lastCheckedAt: registrationChecked ? timestamp : null },
    },
  };
  return clone(db.onboardingStatus);
}

export const demoApi = {
  // ---- session / status ---------------------------------------------------
  session: async () => (await delay(READ), clone(db.session)),
  live: async () => (await delay(READ), clone(db.live)),
  recoveryStatus: async (): Promise<RecoveryStatus> => (await delay(READ), {
    status: "ok",
    recovery: { bound: true, status: "healthy", custody: "non-custodial", createdAt: activeOrg().createdAt, lastSeenAt: now(), nextSteps: [] },
  }),

  // ---- read models --------------------------------------------------------
  dashboard: async () => (await delay(READ), dashboardSummary(db)),
  orgTreasury: async (_orgId: string) => (await delay(READ), treasuryView(db)),
  accounts: async () => (await delay(READ), clone(db.accounts)),
  members: async () => (await delay(READ), clone(db.members)),
  counterparties: async () => (await delay(READ), clone(db.counterparties)),
  payments: async () => (await delay(READ), clone(db.payments)),
  invoices: async () => (await delay(READ), clone(db.invoices)),
  grants: async () => (await delay(READ), clone(db.grants)),
  policies: async () => (await delay(READ), clone(db.policies)),
  integrations: async () => (await delay(READ), clone(db.integrations)),
  invites: async () => (await delay(READ), clone(db.invites)),
  ledger: async () => (await delay(READ), clone(db.ledger)),
  proofReceipts: async () => (await delay(READ), []),

  // ---- treasury -----------------------------------------------------------
  depositToTreasury: async (_orgId: string, body: DepositToTreasuryRequest): Promise<DepositToTreasuryResponse> => {
    await delay(SETTLE);
    const txHash = fakeTx();
    if (body.token === "usdc") db.privateTotal = (BigInt(db.privateTotal) + BigInt(body.amount)).toString();
    const deposit = {
      id: `dep_${randHex(6)}`,
      kind: "direct" as const,
      amount: body.amount,
      token: body.token,
      status: "credited" as const,
      txHash,
      sourceChain: "avalanche-fuji",
      createdAt: now(),
      updatedAt: now(),
    };
    db.treasuryDeposits.unshift(deposit);
    return { amount: body.amount, source: "direct", status: "confirmed", token: body.token, tokenId: `avalanche-fuji:${body.token}`, txHash };
  },
  treasuryDeposits: async (_orgId: string, query: { limit?: number; before?: string } = {}): Promise<TreasuryDepositsResponse> => {
    await delay(READ);
    const start = query.before ? db.treasuryDeposits.findIndex((d) => d.id === query.before) + 1 : 0;
    const from = Math.max(0, start);
    const limit = query.limit ?? 20;
    const deposits = db.treasuryDeposits.slice(from, from + limit);
    const next = db.treasuryDeposits[from + limit]?.id;
    return { deposits: clone(deposits), nextCursor: next };
  },
  proveKyb: async () => (await delay(PROVE), { ok: true, onChain: true, jurisdiction: "US", tier: "verified", ref: fakeRef("KYB credential", "KYB") }),
  periodTotalAttestation: async (period: string) => {
    await delay(PROVE);
    const total = db.payrollRuns.filter((p) => p.status === "complete").reduce((s, p) => s + parseTokenAmount(p.totalAmount), 0n).toString();
    return { live: true, org: activeOrg().name, period, total, onChain: true, vkId: "ORGSUM", verifier: fakeVerifier(), network: NETWORK, root: fakeRoot(), proof: {}, publicInputs: [total], issuedAt: now() };
  },

  // ---- contractors --------------------------------------------------------
  updateCounterparty: async (id: string, patch: { payRate?: string; status?: Counterparty["status"]; handle?: string; name?: string }) => {
    await delay(READ);
    const c = byId(db.counterparties, id);
    if (!c) throw new Error("not found");
    if (patch.payRate) c.payRate = { amount: patch.payRate, assetCode: "USDC" };
    if (patch.status) c.status = patch.status;
    if (patch.name) c.name = patch.name;
    if (patch.handle) c.paymentAddress = { shielded: patch.handle, spendPub: `0x${randHex(64)}`, viewPub: `0x${randHex(64)}`, mvkScalar: `0x${randHex(48)}` };
    return clone(c);
  },
  importRoster: async (csv: string) => {
    await delay(SETTLE);
    const contractors: Counterparty[] = [];
    const errors: Array<{ line: number; error: string }> = [];
    csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
      if (/^name\s*,/i.test(line)) return; // header
      const [name, handle, rate] = line.split(",").map((s) => s.trim());
      if (!name || !rate || Number.isNaN(Number(rate))) {
        errors.push({ line: i + 1, error: "Expected: name, @handle, monthly USDC" });
        return;
      }
      const c: Counterparty = {
        id: `cp_imp_${randHex(6)}`,
        orgId: activeOrg().id,
        name,
        type: "contractor",
        status: "pending_screening",
        externalAccounts: [],
        taxFormType: "none",
        payRate: { amount: usd(Number(rate)), assetCode: "USDC" },
        payCadence: "monthly",
        paymentAddress: handle ? { shielded: handle.startsWith("@") ? handle : `@${handle}`, spendPub: `0x${randHex(64)}`, viewPub: `0x${randHex(64)}`, mvkScalar: `0x${randHex(48)}` } : undefined,
        createdAt: now(),
      };
      db.counterparties.push(c);
      contractors.push(c);
    });
    return { imported: contractors.length, errors, contractors };
  },
  contractorHistory: async (id: string) => {
    await delay(READ);
    const c = byId(db.counterparties, id);
    const rate = c?.payRate?.amount ?? "0";
    if (!c || c.type !== "contractor" || c.status !== "allowlisted") return [];
    return [
      { period: "2026-06", amount: rate, status: "paid", txHash: fakeTx(), batchId: "pr_jun" },
      { period: "2026-05", amount: rate, status: "paid", txHash: fakeTx(), batchId: "pr_may" },
    ];
  },

  // ---- payments (Pay + Approvals) -----------------------------------------
  createPayment: async (body: { amount: { amount: string }; toCounterpartyId?: string; toHandle?: string; memo?: string; fromAccountId: string; type: PaymentOrder["type"] }) => {
    await delay(SETTLE);
    const overThreshold = BigInt(body.amount.amount) > BigInt(usd(10000));
    const po: PaymentOrder = {
      id: `po_${randHex(6)}`,
      orgId: activeOrg().id,
      type: body.type,
      status: overThreshold ? "needs_approval" : "confirmed",
      amount: { amount: body.amount.amount, assetCode: "USDC" },
      fromAccountId: body.fromAccountId,
      toCounterpartyId: body.toCounterpartyId,
      memo: body.memo,
      privacy: { amountHidden: true, counterpartyHidden: true, visibleTo: ["mem_owner"] },
      settlement: overThreshold ? {} : { onChain: true, txHash: fakeTx(), mode: "onchain" },
      approvals: [],
      createdByMemberId: "mem_owner",
      createdAt: now(),
      updatedAt: now(),
    };
    db.payments.unshift(po);
    return clone(po);
  },
  approvePayment: async (id: string, body: { decision: "approved" | "denied" }) => {
    await delay(SETTLE);
    const p = byId(db.payments, id);
    if (!p) throw new Error("not found");
    if (body.decision === "denied") {
      p.status = "cancelled";
      return clone(p);
    }
    p.status = "confirmed";
    p.settlement = { onChain: true, txHash: fakeTx(), mode: "onchain" };
    p.updatedAt = now();
    const progress: ApprovalProgressView = { required: true, satisfied: true, nextRole: null, nextKind: null, steps: [{ stepIndex: 0, role: "approver", need: 1, have: 1, satisfied: true, kind: "release" }] };
    return { ...clone(p), progress };
  },

  // ---- payroll ------------------------------------------------------------
  createPayrollRun: async (_orgId: string, body: CreatePayrollRunRequest): Promise<CreatePayrollRunResponse> => {
    await delay(SETTLE);
    const parsed = parsePayrollCsv(body.csv, body.token ?? "usdc");
    const timestamp = now();
    const runId = `pr_${randHex(6)}`;
    const run: PayrollRun = {
      id: runId,
      orgId: activeOrg().id,
      status: parsed.status,
      itemCount: parsed.summary.total,
      totalAmount: parsed.summary.totalAmount,
      token: parsed.token,
      tokenId: parsed.tokenId,
      createdBy: db.session.user.id,
      error: parsed.status === "failed" ? "CSV validation failed." : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.payrollRuns.unshift(run);
    db.payrollItems[runId] = parsed.items;
    db.payrollProgress[runId] = payrollProgress(parsed.items);
    return { runId, ...clone(parsed) };
  },
  getPayrollRun: async (runId: string): Promise<PayrollRunResponse> => {
    await delay(READ);
    return payrollSnapshot(runId);
  },
  subscribePayrollProgress: (runId: string, onProgress: (event: { runId: string; status: PayrollRun["status"]; progress: PayrollProgressCounts }) => void, onError?: (error: Error) => void) => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      closed = true;
      if (timer) clearTimeout(timer);
    };
    const tick = () => {
      if (closed) return;
      void demoApi.getPayrollRun(runId).then(
        ({ run, progress }) => {
          if (closed) return;
          onProgress({ runId: run.id, status: run.status, progress });
          if (run.status === "complete" || run.status === "failed") {
            close();
            return;
          }
          timer = setTimeout(tick, 450);
        },
        (error) => {
          if (closed) return;
          onError?.(error instanceof Error ? error : new Error("Payroll progress polling failed."));
          timer = setTimeout(tick, 450);
        },
      );
    };
    tick();
    return { close };
  },
  startPayrollRun: async (runId: string): Promise<StartPayrollRunResponse> => {
    await delay(SETTLE);
    const run = byId(db.payrollRuns, runId);
    if (!run) throw new Error("not found");
    if (run.status !== "ready" && run.status !== "paused") throw new Error("Run is not ready to start.");
    run.status = "running";
    run.updatedAt = now();
    for (const item of db.payrollItems[runId] ?? []) {
      if (item.status !== "failed" && item.status !== "confirmed") item.status = "pending";
    }
    db.payrollProgress[runId] = payrollProgress(db.payrollItems[runId] ?? []);
    schedulePayrollProgress(runId);
    const progress = clone(db.payrollProgress[runId]);
    return { runId, status: "running", enqueued: true, totalPending: progress.pending, progress };
  },
  pausePayrollRun: async (runId: string): Promise<PausePayrollRunResponse> => {
    await delay(READ);
    const run = byId(db.payrollRuns, runId);
    if (!run) throw new Error("not found");
    clearPayrollTimers(runId);
    run.status = "paused";
    run.updatedAt = now();
    db.payrollProgress[runId] = payrollProgress(db.payrollItems[runId] ?? []);
    return { runId, status: "paused", progress: clone(db.payrollProgress[runId]) };
  },
  resumePayrollRun: async (runId: string): Promise<ResumePayrollRunResponse> => {
    await delay(SETTLE);
    const run = byId(db.payrollRuns, runId);
    if (!run) throw new Error("not found");
    if (run.status !== "paused") throw new Error("Run is not paused.");
    run.status = "running";
    run.updatedAt = now();
    schedulePayrollProgress(runId);
    const progress = clone(db.payrollProgress[runId] ?? payrollProgress(db.payrollItems[runId] ?? []));
    return { runId, status: "running", enqueued: true, totalPending: progress.pending, progress };
  },

  // ---- invoices -----------------------------------------------------------
  createInvoice: async (body: { counterpartyId: string; number?: string; lineItems: Invoice["lineItems"]; assetCode: string; dueDate?: string; externalId?: string; counterpartyName?: string }) => {
    await delay(READ);
    const total = body.lineItems.reduce((s, li) => s + BigInt(li.unitAmount) * BigInt(li.quantity), 0n).toString();
    const inv: Invoice = { id: `inv_${randHex(6)}`, orgId: activeOrg().id, number: body.number ?? `INV-${randHex(4)}`, counterpartyId: body.counterpartyId, lineItems: body.lineItems, total: { amount: total, assetCode: body.assetCode }, status: "open", dueDate: body.dueDate, paymentOrderIds: [], externalId: body.externalId, createdAt: now() };
    db.invoices.unshift(inv);
    return clone(inv);
  },
  payInvoice: async (id: string) => {
    await delay(SETTLE);
    const inv = byId(db.invoices, id);
    if (!inv) throw new Error("not found");
    inv.status = "paid";
    const payment: PaymentOrder = { id: `po_${randHex(6)}`, orgId: activeOrg().id, type: "invoice_payment", status: "confirmed", amount: inv.total, fromAccountId: "acct_operating", toCounterpartyId: inv.counterpartyId, memo: inv.number, privacy: { amountHidden: true, counterpartyHidden: true, visibleTo: ["mem_owner"] }, settlement: { onChain: true, txHash: fakeTx(), mode: "onchain" }, createdByMemberId: "mem_owner", createdAt: now(), updatedAt: now() };
    inv.paymentOrderIds.push(payment.id);
    db.payments.unshift(payment);
    return { invoice: clone(inv), payment: clone(payment) };
  },
  netInvoices: async (weOwe: string, theyOwe: string) => {
    await delay(PROVE);
    const net = (BigInt(weOwe || "0") - BigInt(theyOwe || "0")).toString();
    return { onChain: true, net, wetPay: BigInt(net) > 0n, ref: fakeRef("Invoice netting", "NETTING") };
  },

  // ---- grants -------------------------------------------------------------
  createGrant: async (body: { auditorName: string; auditorPubKey: string; tier: ViewingGrant["tier"]; scope: ViewingGrant["scope"]; expiry: string }) => {
    await delay(READ);
    const grant: ViewingGrant = { id: `vg_${randHex(6)}`, orgId: activeOrg().id, auditorName: body.auditorName, auditorPubKey: body.auditorPubKey, tier: body.tier, scope: body.scope, onChainKeyHash: fakeTx(), expiry: body.expiry, status: "active", portalUrl: `https://portal.benzo.space/g/${randHex(6)}`, createdAt: now() };
    db.grants.unshift(grant);
    return clone(grant);
  },
  revokeGrant: async (id: string) => {
    await delay(SETTLE);
    const g = byId(db.grants, id);
    if (!g) throw new Error("not found");
    g.status = "revoked";
    return clone(g);
  },

  // ---- audit log ----------------------------------------------------------
  ledgerVerify: async () => (await delay(PROVE), { ok: true, length: db.ledger.length }),
  privateAuditPacket: async (): Promise<PrivateAuditPacketResponse> => {
    await delay(PROVE);
    const headHash = fakeTx();
    const merkleRoot = fakeRoot();
    const envelopes = db.ledger.map((e, i) => ({ id: e.id, orgId: e.orgId, type: e.sourceType, subjectId: e.sourceId ?? e.id, schema: "benzo.event.v1", occurredAt: e.postedAt, publicMeta: { kind: e.sourceType }, ciphertext: randHex(48), iv: randHex(24), tag: randHex(16), aadHash: fakeTx(), payloadHash: fakeTx(), prevHash: i === 0 ? "0x0" : fakeTx(), hash: e.hash ?? fakeTx() }));
    return {
      packet: {
        orgId: activeOrg().id,
        scope: { label: "All private events" },
        anchor: { orgId: activeOrg().id, eventCount: envelopes.length, headHash, merkleRoot, anchoredAt: now() },
        envelopes,
        inclusionProofs: envelopes.map((e, i) => ({ eventHash: e.hash, siblings: [fakeTx(), fakeTx()], index: i })),
        issuedAt: now(),
      },
      integrity: { ok: true, headHash },
      disclosure: "This packet discloses hashes and a Merkle root only; records stay ciphertext.",
    };
  },
  anchorPrivateAuditRoot: async (body?: { packet?: PrivateAuditPacketResponse["packet"] }): Promise<PrivateAuditAnchorResponse> => {
    await delay(SETTLE);
    const built = body?.packet ?? (await demoApi.privateAuditPacket()).packet;
    const txHash = fakeTx();
    return {
      packet: built,
      integrity: { ok: true, headHash: built.anchor.headHash },
      disclosure: "Anchored on-chain — only the Merkle root leaves the ciphertext.",
      packetHash: fakeTx(),
      orgHash: fakeTx(),
      anchor: { onChain: true, contractId: fakeVerifier(), txHash, sequence: String(Math.floor(Math.random() * 90000) + 10000), explorer: explorerTxUrl(txHash) },
    };
  },

  // ---- team invites -------------------------------------------------------
  createInvite: async (body: { kind: OrgInvite["kind"]; name?: string; email?: string; role?: string }) => {
    await delay(READ);
    const token = randHex(10);
    const invite: OrgInvite = { id: `invt_${randHex(6)}`, kind: body.kind, name: body.name, email: body.email, role: body.role, link: `https://console.benzo.space/claim#${token}`, token, status: "sent", createdAt: now() };
    db.invites.unshift(invite);
    return clone(invite);
  },
  revokeInvite: async (id: string) => {
    await delay(READ);
    const inv = byId(db.invites, id);
    if (!inv) throw new Error("not found");
    inv.status = "revoked";
    return clone(inv);
  },
  bulkInvite: async () => (await delay(READ), { created: 0, errors: [], invites: [] }),
  acceptInvite: async (body: { token: string; name?: string }) => (await delay(READ), { ok: true, orgName: activeOrg().name, kind: "member" as const, orgId: activeOrg().id }),

  // ---- policies (empty in the seed, but keep the surface complete) --------
  updatePolicy: async (id: string) => {
    await delay(READ);
    const p = byId(db.policies, id);
    if (!p) throw new Error("No approval policy");
    return clone(p);
  },

  // ---- onboarding / auth -------------------------------------------------
  createOrg: async (body: { name: string; slug: string }): Promise<CreateOrgResponse> => {
    await delay(READ);
    const org = { id: `org_${randHex(6)}`, name: body.name, slug: body.slug, role: "owner" as const, createdAt: now() };
    db.session.orgs = [org, ...db.session.orgs.filter((existing) => existing.id !== org.id)];
    db.session.activeOrg = org;
    db.session.role = "owner";
    return { org: clone(org), role: "owner" };
  },
  startOnboarding: async (mockKyc?: { name?: string; country?: string }): Promise<StartOnboardingResponse> => {
    await delay(READ);
    demoMockKyc = mockKyc;
    db.onboardingStatus = {
      ...db.onboardingStatus,
      id: `onb_${randHex(6)}`,
      status: "pending_kyc",
      error: null,
      createdAt: now(),
      updatedAt: now(),
      mockKyc: null,
      steps: {
        kyc: { completedAt: null, provider: null },
        allowlist: { completedAt: null, result: null, txHash: null },
        gas: { completedAt: null, result: null, txHash: null },
        registration: { completedAt: null, lastCheckedAt: null },
      },
    };
    return { jobId: `job_${randHex(8)}`, onboarding: clone(db.onboardingStatus) };
  },
  onboardingStatus: async (): Promise<OnboardingStatusResponse> => (await delay(READ), { onboarding: clone(db.onboardingStatus) }),
  subscribeOnboardingStatus: (onStatus: (onboarding: OnboardingStatus) => void): { close: () => void } => {
    let closed = false;
    const timers = ONBOARDING_STATUSES.map((status, index) => window.setTimeout(() => {
      if (closed) return;
      onStatus(setDemoOnboardingStatus(status, demoMockKyc));
    }, index * ONBOARDING_STEP));
    return {
      close: () => {
        closed = true;
        timers.forEach((timer) => window.clearTimeout(timer));
      },
    };
  },
  provisionTreasury: async (_orgId: string): Promise<ProvisionTreasuryResponse> => {
    await delay(SETTLE);
    db.treasuryProvision = { ...db.treasuryProvision, registered: true, consented: true, registrationTxHash: fakeTx() };
    return clone(db.treasuryProvision);
  },
  orgs: async () => ({ orgs: clone(db.session.orgs) }),
  siweNonce: async () => ({ nonce: randHex(16) }),
  siweVerify: async () => ({ user: clone(db.session.user) }),
  logout: async () => ({ ok: true as const }),
};
