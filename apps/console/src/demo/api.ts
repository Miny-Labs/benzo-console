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
  Invoice,
  PaymentOrder,
  PayrollBatch,
  ViewingGrant,
} from "@benzo/types";
import type {
  ApprovalProgressView,
  OnChainRef,
  OrgInvite,
  PayrollPolicyProofResponse,
  PayrollProofResponse,
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

// ---- fake-chain helpers ---------------------------------------------------
function randHex(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a.map(() => (Math.random() * 256) | 0) }).getRandomValues(bytes);
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

export const demoApi = {
  // ---- session / status ---------------------------------------------------
  session: async () => (await delay(READ), clone(db.session)),
  live: async () => (await delay(READ), clone(db.live)),
  recoveryStatus: async (): Promise<RecoveryStatus> => (await delay(READ), {
    status: "ok",
    recovery: { bound: true, status: "healthy", custody: "non-custodial", createdAt: db.session.org.createdAt, lastSeenAt: now(), nextSteps: [] },
  }),

  // ---- read models --------------------------------------------------------
  dashboard: async () => (await delay(READ), dashboardSummary(db)),
  treasury: async () => (await delay(READ), treasuryView(db)),
  accounts: async () => (await delay(READ), clone(db.accounts)),
  members: async () => (await delay(READ), clone(db.members)),
  counterparties: async () => (await delay(READ), clone(db.counterparties)),
  payments: async () => (await delay(READ), clone(db.payments)),
  payrolls: async () => (await delay(READ), clone(db.payrolls)),
  invoices: async () => (await delay(READ), clone(db.invoices)),
  grants: async () => (await delay(READ), clone(db.grants)),
  policies: async () => (await delay(READ), clone(db.policies)),
  integrations: async () => (await delay(READ), clone(db.integrations)),
  invites: async () => (await delay(READ), clone(db.invites)),
  ledger: async () => (await delay(READ), clone(db.ledger)),
  proofReceipts: async () => (await delay(READ), []),

  // ---- treasury: two-balance model + prove flows --------------------------
  treasuryPublicBalance: async () => (await delay(READ), { units: db.publicUnits, address: db.publicAddress, asset: "USDC", issuer: db.usdcIssuer, live: true }),
  treasuryReceive: async () => (await delay(READ), { address: db.publicAddress, asset: "USDC", issuer: db.usdcIssuer, live: true }),
  treasurySendPublic: async (_to: string, amount: string) => {
    await delay(SETTLE);
    const minor = usd(Number(amount));
    db.publicUnits = (BigInt(db.publicUnits) - BigInt(minor)).toString();
    return { onChain: true, txHash: fakeTx() };
  },
  // "Make private": public -> shielded pool. Grows the private total, shrinks public.
  fundTreasury: async (amount: string) => {
    await delay(SETTLE);
    const minor = usd(Number(amount));
    db.publicUnits = (BigInt(db.publicUnits) - BigInt(minor)).toString();
    db.privateTotal = (BigInt(db.privateTotal) + BigInt(minor)).toString();
    return { onChain: true, txHash: fakeTx() };
  },
  proveBalance: async (min: string) => {
    await delay(PROVE);
    return { holds: BigInt(db.privateTotal) >= BigInt(min || "0"), onChain: true, minUnits: min, ref: fakeRef("Reserves proof", "ORGBAL", [{ k: "Floor", v: min }]) };
  },
  proveTotal: async () => {
    await delay(PROVE);
    return { total: db.privateTotal, onChain: true, ref: fakeRef("Exact total proof", "ORGSUM", [{ k: "Total (committed)", v: db.privateTotal }]) };
  },
  proveSolvency: async () => {
    await delay(PROVE);
    const liabilities = db.invoices.filter((i) => i.status === "open").reduce((s, i) => s + BigInt(i.total.amount), 0n) + BigInt(db.payrolls.find((p) => p.status === "needs_approval")?.total.amount ?? "0");
    return { solvent: true, onChain: true, liabilities: liabilities.toString(), ref: fakeRef("Solvency proof", "ORGSOLV") };
  },
  proveKyb: async () => (await delay(PROVE), { ok: true, onChain: true, jurisdiction: "US", tier: "verified", ref: fakeRef("KYB credential", "KYB") }),
  periodTotalAttestation: async (period: string) => {
    await delay(PROVE);
    const total = db.payrolls.filter((p) => p.status === "completed").reduce((s, p) => s + BigInt(p.total.amount), 0n).toString();
    return { live: true, org: db.session.org.name, period, total, onChain: true, vkId: "ORGSUM", verifier: fakeVerifier(), network: NETWORK, root: fakeRoot(), proof: {}, publicInputs: [total], issuedAt: now() };
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
        orgId: db.session.org.id,
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
      orgId: db.session.org.id,
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

  // ---- payroll (the flagship cinematic) -----------------------------------
  createPayroll: async (body: { period: string; source: PayrollBatch["source"]; lines: Array<{ counterpartyId: string }> }) => {
    await delay(SETTLE);
    const lines = body.lines.map((l) => {
      const c = byId(db.counterparties, l.counterpartyId);
      return { counterpartyId: l.counterpartyId, amount: c?.payRate?.amount ?? "0", rate: c?.payRate?.amount ?? "0", status: "pending" as const };
    });
    const total = lines.reduce((s, l) => s + BigInt(l.amount), 0n).toString();
    const batch: PayrollBatch = { id: `pr_${randHex(6)}`, orgId: db.session.org.id, period: body.period, source: body.source, status: "needs_approval", lines, total: { amount: total, assetCode: "USDC" }, createdAt: now() };
    db.payrolls.unshift(batch);
    return clone(batch);
  },
  proveFunded: async (id: string): Promise<PayrollProofResponse> => {
    await delay(PROVE);
    const b = byId(db.payrolls, id);
    const runTotal = b?.total.amount ?? "0";
    return { funded: true, onChain: true, runTotal, cap: usd(5000), provenAt: now(), ref: fakeRef("Payroll funded", "ORGBAL", [{ k: "Covers run total", v: "yes" }]) };
  },
  provePolicy: async (id: string, cap: string): Promise<PayrollPolicyProofResponse> => {
    await delay(PROVE);
    const b = byId(db.payrolls, id);
    const lines = (b?.lines ?? []).map((l) => ({ counterpartyId: l.counterpartyId, capProof: { withinCap: true, onChain: true }, screenProof: { innocent: true, onChain: true } }));
    return { ok: true, onChain: true, lines, ref: fakeRef("Spending policy", "SPENDCAP", [{ k: "Per-payout cap", v: cap }]) };
  },
  proveComputation: async (id: string): Promise<PayrollProofResponse> => {
    await delay(PROVE);
    const b = byId(db.payrolls, id);
    return { ok: true, onChain: true, runTotal: b?.total.amount ?? "0", provenAt: now(), ref: fakeRef("Payroll computation", "PAYCOMP") };
  },
  proveApproval: async (id: string): Promise<PayrollProofResponse> => {
    await delay(PROVE);
    return { approved: true, onChain: true, approvers: 2, threshold: 2, memberCount: db.members.length, provenAt: now(), ref: fakeRef("Anonymous approval", "ORGAUTH", [{ k: "Approvers", v: "2-of-4" }]) };
  },
  // One click settles the run: mutate every line to paid + on-chain, attach the
  // three proofs, and return with a satisfied release gate so the ceremony settles.
  approvePayroll: async (id: string) => {
    await delay(SETTLE);
    const b = byId(db.payrolls, id);
    if (!b) throw new Error("not found");
    b.status = "completed";
    b.lines = b.lines.map((l) => {
      const payable = !!byId(db.counterparties, l.counterpartyId)?.paymentAddress?.shielded;
      return payable
        ? { ...l, status: "paid" as const, onChain: true, txHash: fakeTx(), capProof: { withinCap: true, onChain: true }, screenProof: { innocent: true, onChain: true } }
        : { ...l, status: "paid" as const, onChain: true, txHash: fakeTx() };
    });
    b.fundedProof = { funded: true, onChain: true, provenAt: now() };
    b.approvalProof = { approved: true, onChain: true, approvers: 2, threshold: 2, memberCount: db.members.length, provenAt: now() };
    b.computationProof = { ok: true, onChain: true, runTotal: b.total.amount, provenAt: now() };
    // No `progress` field => Payroll treats this click as the final step and settles.
    return clone(b);
  },
  payslips: async (id: string) => {
    await delay(READ);
    const b = byId(db.payrolls, id);
    return (b?.lines ?? []).map((l) => ({ period: b?.period ?? "", contractor: byId(db.counterparties, l.counterpartyId)?.name ?? "Unknown", gross: l.amount, status: l.status, txHash: l.txHash }));
  },

  // ---- invoices -----------------------------------------------------------
  createInvoice: async (body: { counterpartyId: string; number?: string; lineItems: Invoice["lineItems"]; assetCode: string; dueDate?: string; externalId?: string; counterpartyName?: string }) => {
    await delay(READ);
    const total = body.lineItems.reduce((s, li) => s + BigInt(li.unitAmount) * BigInt(li.quantity), 0n).toString();
    const inv: Invoice = { id: `inv_${randHex(6)}`, orgId: db.session.org.id, number: body.number ?? `INV-${randHex(4)}`, counterpartyId: body.counterpartyId, lineItems: body.lineItems, total: { amount: total, assetCode: body.assetCode }, status: "open", dueDate: body.dueDate, paymentOrderIds: [], externalId: body.externalId, createdAt: now() };
    db.invoices.unshift(inv);
    return clone(inv);
  },
  payInvoice: async (id: string) => {
    await delay(SETTLE);
    const inv = byId(db.invoices, id);
    if (!inv) throw new Error("not found");
    inv.status = "paid";
    const payment: PaymentOrder = { id: `po_${randHex(6)}`, orgId: db.session.org.id, type: "invoice_payment", status: "confirmed", amount: inv.total, fromAccountId: "acct_operating", toCounterpartyId: inv.counterpartyId, memo: inv.number, privacy: { amountHidden: true, counterpartyHidden: true, visibleTo: ["mem_owner"] }, settlement: { onChain: true, txHash: fakeTx(), mode: "onchain" }, createdByMemberId: "mem_owner", createdAt: now(), updatedAt: now() };
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
    const grant: ViewingGrant = { id: `vg_${randHex(6)}`, orgId: db.session.org.id, auditorName: body.auditorName, auditorPubKey: body.auditorPubKey, tier: body.tier, scope: body.scope, onChainKeyHash: fakeTx(), expiry: body.expiry, status: "active", portalUrl: `https://portal.benzo.space/g/${randHex(6)}`, createdAt: now() };
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
        orgId: db.session.org.id,
        scope: { label: "All private events" },
        anchor: { orgId: db.session.org.id, eventCount: envelopes.length, headHash, merkleRoot, anchoredAt: now() },
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
  acceptInvite: async (body: { token: string; name?: string }) => (await delay(READ), { ok: true, orgName: db.session.org.name, kind: "member" as const, orgId: db.session.org.id }),

  // ---- policies (empty in the seed, but keep the surface complete) --------
  updatePolicy: async (id: string) => {
    await delay(READ);
    const p = byId(db.policies, id);
    if (!p) throw new Error("No approval policy");
    return clone(p);
  },

  // ---- onboarding / auth (unused: demo boots straight into the Shell) -----
  onboarding: async () => ({}),
  saveOnboarding: async (patch: unknown) => patch as Record<string, unknown>,
  submitKyb: async () => ({ status: "approved" as const, provider: "demo", inquiryRef: `kyb_${randHex(6)}`, checks: ["identity", "sanctions"], onChain: true, txHash: fakeTx() }),
  kybStatus: async () => ({ status: "approved" as const, inquiryRef: `kyb_${randHex(6)}`, onChain: true }),
  provisionTreasury: async () => ({ onChain: true, txHash: fakeTx(), mvkRoot: fakeRoot(), treasuryAddress: db.publicAddress }),
  registerOwnerMvk: async () => ({ onChain: true, txHash: fakeTx(), mvkRoot: fakeRoot() }),
  finishOnboarding: async () => clone(db.session),
  siweNonce: async () => ({ nonce: randHex(16) }),
  siweVerify: async () => ({ token: `demo.${randHex(24)}`, tokenType: "Bearer" as const, session: clone(db.session) }),
};
