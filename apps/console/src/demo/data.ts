/**
 * Seed data for demo mode, a rich, believable org so every console screen and
 * cinematic has something real to render with zero backend. Pure factory: it
 * returns a fresh, mutable in-memory "db" the demo api reads/writes, so a session
 * feels alive (approvals clear, payroll completes, grants revoke) without a network.
 */
import type {
  Account,
  ApprovalPolicy,
  AuthSession,
  Counterparty,
  DashboardSummary,
  Integration,
  Invoice,
  LedgerEntry,
  LiveStatusResponse,
  Member,
  OnboardingStatus,
  PaymentOrder,
  PayrollProgressCounts,
  PayrollRun,
  PayrollRunItem,
  ProvisionTreasuryResponse,
  TreasuryDeposit,
  TreasuryView,
  ViewingGrant,
} from "@benzo/types";
import type { OrgInvite } from "../lib/api";

const ORG_ID = "org_meridian";
const DEMO_OWNER_ADDRESS = "0x7A58c0Be72BE218B41C608b7Fe7C5bB630736C71";

/** dollars (with cents) -> USDC minor units (6dp) string. */
export function usd(dollars: number): string {
  return (BigInt(Math.round(dollars * 100)) * 10_000n).toString();
}

const ISO = (d: string) => new Date(d).toISOString();

export interface DemoDb {
  session: AuthSession;
  live: LiveStatusResponse;
  members: Member[];
  accounts: Account[];
  counterparties: Counterparty[];
  payrollRuns: PayrollRun[];
  payrollItems: Record<string, PayrollRunItem[]>;
  payrollProgress: Record<string, PayrollProgressCounts>;
  payments: PaymentOrder[];
  invoices: Invoice[];
  grants: ViewingGrant[];
  policies: ApprovalPolicy[];
  integrations: Integration[];
  invites: OrgInvite[];
  ledger: LedgerEntry[];
  onboardingStatus: OnboardingStatus;
  treasuryProvision: ProvisionTreasuryResponse;
  treasuryDeposits: TreasuryDeposit[];
  /** Private (shielded) pool total, minor units, grows when "Make private" runs. */
  privateTotal: string;
  /** Public liquid USDC balance, minor units. */
  publicUnits: string;
  /** The org's own public USDC address (Receive / Send to a wallet). */
  publicAddress: string;
  usdcIssuer: string;
  dashboardActivity: DashboardSummary["recentActivity"];
}

const shielded = (handle: string, spend: string) => ({
  shielded: handle,
  spendPub: `0x${spend.padEnd(64, "0")}`,
  viewPub: `0x${spend.split("").reverse().join("").padEnd(64, "0")}`,
  mvkScalar: `0x${spend.padEnd(48, "a")}`,
});

export function createDemoDb(): DemoDb {
  const publicAddress = "0x9Fb2c7A11e4D3f6B8a0C15e2D9f4A7c3B6e1D8a2";
  const owner: Member = {
    id: "mem_owner",
    orgId: ORG_ID,
    email: "jordan@meridianlabs.xyz",
    name: "Jordan Ellis",
    role: "owner",
    status: "active",
    signerAddress: DEMO_OWNER_ADDRESS,
    createdAt: ISO("2026-02-03"),
  };
  const members: Member[] = [
    owner,
    { id: "mem_approver", orgId: ORG_ID, email: "sam@meridianlabs.xyz", name: "Sam Rivera", role: "approver", status: "active", createdAt: ISO("2026-02-10") },
    { id: "mem_treasurer", orgId: ORG_ID, email: "alex@meridianlabs.xyz", name: "Alex Kim", role: "treasurer", status: "active", createdAt: ISO("2026-02-12") },
    { id: "mem_admin", orgId: ORG_ID, email: "robin@meridianlabs.xyz", name: "Robin Chase", role: "admin", status: "active", createdAt: ISO("2026-03-01") },
  ];

  const org: AuthSession["orgs"][number] = {
    id: ORG_ID,
    name: "Meridian Labs",
    slug: "meridian-labs",
    role: "owner",
    legalName: "Meridian Labs, Inc.",
    country: "US",
    kybStatus: "approved",
    complianceZoneId: "us",
    baseAssetCode: "USDC",
    createdAt: ISO("2026-02-03"),
  };

  const session: AuthSession = {
    user: { id: owner.id, address: DEMO_OWNER_ADDRESS, roles: ["owner"] },
    orgs: [org],
    activeOrg: org,
    role: "owner",
  };

  const accounts: Account[] = [
    { id: "acct_operating", orgId: ORG_ID, name: "Operating", type: "operating", assetCode: "USDC", shieldedAddress: "@meridian.ops", createdAt: ISO("2026-02-03") },
    { id: "acct_payroll", orgId: ORG_ID, name: "Payroll", type: "payroll", assetCode: "USDC", shieldedAddress: "@meridian.pay", createdAt: ISO("2026-02-03") },
  ];

  const mkContractor = (
    id: string,
    name: string,
    handle: string,
    rate: number,
    status: Counterparty["status"],
    tax: Counterparty["taxFormType"],
    payable: boolean,
  ): Counterparty => ({
    id,
    orgId: ORG_ID,
    name,
    type: "contractor",
    status,
    email: `${handle.replace("@", "")}@contractor.dev`,
    paymentAddress: payable ? shielded(handle, id.replace(/[^0-9a-f]/gi, "")) : undefined,
    externalAccounts: [],
    taxFormType: tax,
    payRate: { amount: usd(rate), assetCode: "USDC" },
    payCadence: "monthly",
    createdAt: ISO("2026-02-15"),
  });

  const counterparties: Counterparty[] = [
    mkContractor("cp_aisha", "Aisha Nakamoto", "@aisha", 8500, "allowlisted", "W9", true),
    mkContractor("cp_diego", "Diego Santos", "@diego", 6200, "allowlisted", "W8-BEN", true),
    mkContractor("cp_priya", "Priya Venkatesh", "@priya", 9000, "allowlisted", "W9", true),
    mkContractor("cp_liam", "Liam O'Connor", "@liam", 5400, "allowlisted", "W8-BEN", true),
    mkContractor("cp_mei", "Mei Chen", "@mei", 7300, "allowlisted", "W9", true),
    mkContractor("cp_tomas", "Tomas Novak", "@tomas", 4800, "pending_screening", "none", false),
    {
      id: "cp_northwind",
      orgId: ORG_ID,
      name: "Northwind Components",
      type: "vendor",
      status: "allowlisted",
      email: "ap@northwind.co",
      paymentAddress: shielded("@northwind", "c0ffee"),
      externalAccounts: [],
      taxFormType: "W9",
      createdAt: ISO("2026-02-20"),
    },
  ];

  const payableIds = ["cp_aisha", "cp_diego", "cp_priya", "cp_liam", "cp_mei"];
  const rateOf = (id: string) => counterparties.find((c) => c.id === id)?.payRate?.amount ?? "0";
  const runTotal = payableIds.reduce((s, id) => s + BigInt(rateOf(id)), 0n).toString();
  const fakeHash = (seed: string) => `0x${seed.repeat(8).slice(0, 64)}`;

  const privacy = (amountHidden: boolean) => ({ amountHidden, counterpartyHidden: true, visibleTo: ["mem_owner"] });

  const payments: PaymentOrder[] = [
    {
      id: "po_pending",
      orgId: ORG_ID,
      type: "shielded_transfer",
      status: "needs_approval",
      amount: { amount: usd(18000), assetCode: "USDC" },
      fromAccountId: "acct_operating",
      toCounterpartyId: "cp_northwind",
      memo: "Q3 cloud infrastructure",
      privacy: privacy(false),
      settlement: {},
      approvals: [],
      createdByMemberId: "mem_treasurer",
      createdAt: ISO("2026-07-08T14:10:00Z"),
      updatedAt: ISO("2026-07-08T14:10:00Z"),
    },
    {
      id: "po_done_1",
      orgId: ORG_ID,
      type: "shielded_transfer",
      status: "confirmed",
      amount: { amount: usd(6200), assetCode: "USDC" },
      fromAccountId: "acct_operating",
      toCounterpartyId: "cp_diego",
      memo: "Design retainer",
      privacy: privacy(true),
      settlement: { onChain: true, txHash: fakeHash("d1e6"), mode: "onchain" },
      createdByMemberId: "mem_treasurer",
      createdAt: ISO("2026-07-05T09:00:00Z"),
      updatedAt: ISO("2026-07-05T09:01:00Z"),
    },
    {
      id: "po_done_2",
      orgId: ORG_ID,
      type: "invoice_payment",
      status: "confirmed",
      amount: { amount: usd(9800), assetCode: "USDC" },
      fromAccountId: "acct_operating",
      toCounterpartyId: "cp_northwind",
      memo: "INV-2039",
      privacy: privacy(true),
      settlement: { onChain: true, txHash: fakeHash("9800"), mode: "onchain" },
      createdByMemberId: "mem_owner",
      createdAt: ISO("2026-06-28T16:20:00Z"),
      updatedAt: ISO("2026-06-28T16:22:00Z"),
    },
  ];

  const invoices: Invoice[] = [
    {
      id: "inv_2041",
      orgId: ORG_ID,
      number: "INV-2041",
      counterpartyId: "cp_northwind",
      lineItems: [
        { description: "Precision actuators (batch 12)", quantity: 40, unitAmount: usd(280) },
        { description: "Freight & handling", quantity: 1, unitAmount: usd(1200) },
      ],
      total: { amount: usd(12400), assetCode: "USDC" },
      status: "open",
      dueDate: ISO("2026-07-22"),
      paymentOrderIds: [],
      createdAt: ISO("2026-07-06"),
    },
    {
      id: "inv_2042",
      orgId: ORG_ID,
      number: "INV-2042",
      counterpartyId: "cp_diego",
      lineItems: [{ description: "Brand system, July milestone", quantity: 1, unitAmount: usd(6200) }],
      total: { amount: usd(6200), assetCode: "USDC" },
      status: "open",
      dueDate: ISO("2026-07-25"),
      paymentOrderIds: [],
      createdAt: ISO("2026-07-07"),
    },
    {
      id: "inv_2039",
      orgId: ORG_ID,
      number: "INV-2039",
      counterpartyId: "cp_northwind",
      lineItems: [{ description: "Precision actuators (batch 11)", quantity: 35, unitAmount: usd(280) }],
      total: { amount: usd(9800), assetCode: "USDC" },
      status: "paid",
      paymentOrderIds: ["po_done_2"],
      createdAt: ISO("2026-06-24"),
    },
  ];

  const grants: ViewingGrant[] = [
    {
      id: "vg_1",
      orgId: ORG_ID,
      auditorName: "Grant Thornton LLP",
      auditorPubKey: "0x04a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      tier: "outgoing",
      scope: { accountIds: [], from: ISO("2026-04-01"), to: ISO("2026-06-30"), label: "2026-Q2 payroll" },
      onChainKeyHash: fakeHash("a4d1"),
      expiry: ISO("2026-10-01"),
      status: "active",
      portalUrl: "https://portal.benzo.space/g/vg_1",
      createdAt: ISO("2026-07-01"),
    },
    {
      id: "vg_2",
      orgId: ORG_ID,
      auditorName: "Deloitte Tax",
      auditorPubKey: "0x0492aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc5566",
      tier: "full",
      scope: { accountIds: [], from: null, to: null, label: "2026-Q1 review" },
      expiry: ISO("2026-04-15"),
      status: "revoked",
      createdAt: ISO("2026-01-08"),
    },
  ];

  const integrations: Integration[] = [
    { id: "int_qb", orgId: ORG_ID, provider: "quickbooks", status: "connected", connectedAt: ISO("2026-02-06"), lastSyncAt: ISO("2026-07-09T02:00:00Z") },
    { id: "int_slack", orgId: ORG_ID, provider: "slack", status: "connected", connectedAt: ISO("2026-02-06") },
    { id: "int_gusto", orgId: ORG_ID, provider: "gusto", status: "error", connectedAt: ISO("2026-03-01"), lastError: "Reauthorize the Gusto connection" },
  ];

  const invites: OrgInvite[] = [
    { id: "invt_1", kind: "member", name: "Taylor Brooks", email: "taylor@meridianlabs.xyz", role: "approver", link: "https://console.benzo.space/claim#invt_1", token: "invt_1", status: "sent", createdAt: ISO("2026-07-07") },
  ];

  const mkEntry = (id: string, sourceType: LedgerEntry["sourceType"], amount: string, when: string, txId?: string): LedgerEntry => ({
    id,
    orgId: ORG_ID,
    txId,
    postedAt: ISO(when),
    sourceType,
    lines: [
      { accountId: "acct_operating", direction: "debit", amount, assetCode: "USDC" },
      { accountId: "acct_payroll", direction: "credit", amount, assetCode: "USDC" },
    ],
    hash: fakeHash(id.slice(-4)),
  });
  const ledger: LedgerEntry[] = [
    mkEntry("le_1", "shield", usd(500000), "2026-05-02T10:00:00Z", fakeHash("5h1e")),
    mkEntry("le_2", "payroll", runTotal, "2026-06-01T12:00:00Z", fakeHash("pay6")),
    mkEntry("le_3", "invoice", usd(9800), "2026-06-28T16:22:00Z", fakeHash("9800")),
    mkEntry("le_4", "shield", usd(120000), "2026-07-02T09:30:00Z", fakeHash("5h2e")),
    mkEntry("le_5", "transfer", usd(6200), "2026-07-05T09:01:00Z", fakeHash("d1e6")),
    mkEntry("le_6", "fee", usd(1.2), "2026-07-05T09:01:30Z"),
  ];

  const dashboardActivity: DashboardSummary["recentActivity"] = [
    { id: "po_pending", kind: "payment", title: "Northwind Components", status: "needs_approval", amountLabel: "$18,000.00", at: ISO("2026-07-08T14:10:00Z") },
    { id: "pr_jun", kind: "payroll", title: "June payroll · 5 people", status: "completed", amountLabel: "Private", at: ISO("2026-06-01T12:00:00Z") },
    { id: "po_done_2", kind: "invoice", title: "INV-2039 · Northwind", status: "paid", amountLabel: "$9,800.00", at: ISO("2026-06-28T16:22:00Z") },
    { id: "dep_1", kind: "deposit", title: "Shielded USDC deposit", status: "confirmed", amountLabel: "Private", at: ISO("2026-07-02T09:30:00Z") },
    { id: "vg_1", kind: "grant", title: "Grant Thornton LLP · Q2", status: "active", amountLabel: "-", at: ISO("2026-07-01T00:00:00Z") },
  ];

  const onboardingStatus: OnboardingStatus = {
    id: "onb_demo",
    userId: owner.id,
    address: DEMO_OWNER_ADDRESS,
    chainEnv: "demo",
    chainId: 43113,
    status: "complete",
    error: null,
    createdAt: ISO("2026-02-03"),
    updatedAt: ISO("2026-02-03T00:05:00Z"),
    mockKyc: { approvedAt: ISO("2026-02-03T00:01:00Z"), payload: { name: org.name, country: org.country }, provider: "demo" },
    steps: {
      kyc: { completedAt: ISO("2026-02-03T00:01:00Z"), provider: "demo" },
      allowlist: { completedAt: ISO("2026-02-03T00:02:00Z"), result: { ok: true }, txHash: fakeHash("a110") },
      gas: { completedAt: ISO("2026-02-03T00:03:00Z"), result: { ok: true }, txHash: fakeHash("9a5") },
      registration: { completedAt: ISO("2026-02-03T00:04:00Z"), lastCheckedAt: ISO("2026-02-03T00:04:00Z") },
    },
  };

  const treasuryProvision: ProvisionTreasuryResponse = {
    address: publicAddress,
    custody: "managed",
    registered: true,
    consented: true,
    registrationTxHash: fakeHash("eerc"),
  };
  const treasuryDeposits: TreasuryDeposit[] = [
    {
      id: "dep_direct_1",
      kind: "direct",
      amount: usd(120000),
      token: "usdc",
      status: "credited",
      txHash: fakeHash("5h2e"),
      sourceChain: "avalanche-fuji",
      createdAt: ISO("2026-07-02T09:30:00Z"),
      updatedAt: ISO("2026-07-02T09:31:00Z"),
    },
    {
      id: "dep_direct_2",
      kind: "direct",
      amount: usd(500000),
      token: "usdc",
      status: "credited",
      txHash: fakeHash("5h1e"),
      sourceChain: "avalanche-fuji",
      createdAt: ISO("2026-05-02T10:00:00Z"),
      updatedAt: ISO("2026-05-02T10:02:00Z"),
    },
  ];

  return {
    session,
    live: { live: true, mode: "live", missing: [] },
    members,
    accounts,
    counterparties,
    payrollRuns: [],
    payrollItems: {},
    payrollProgress: {},
    payments,
    invoices,
    grants,
    policies: [], // left empty on purpose so the dashboard first-run checklist stays visible (4/5 done)
    integrations,
    invites,
    ledger,
    onboardingStatus,
    treasuryProvision,
    treasuryDeposits,
    privateTotal: usd(842300),
    publicUnits: usd(48250),
    publicAddress,
    usdcIssuer: "0x5425890298aed601595a70AB815c96711a31Bc65",
    dashboardActivity,
  };
}

/** Treasury view derived live from the (mutable) db so balances reflect shields. */
export function treasuryView(db: DemoDb): TreasuryView {
  return {
    address: db.treasuryProvision.address,
    custody: "managed",
    registered: db.treasuryProvision.registered,
    consented: db.treasuryProvision.consented,
    custodyConsent: {
      consented: db.treasuryProvision.consented,
      consentedAt: db.treasuryProvision.consented ? db.session.activeOrg?.createdAt ?? null : null,
      consentedBy: db.treasuryProvision.consented ? db.session.user.id : null,
    },
    balances: [
      { token: "usdc", tokenId: "avalanche-fuji:usdc", symbol: "USDC", decimals: 6, amount: db.privateTotal },
      { token: "eurc", tokenId: "avalanche-fuji:eurc", symbol: "EURC", decimals: 6, amount: usd(48250) },
    ],
  };
}

/** Dashboard projection derived live from the mutable db. */
export function dashboardSummary(db: DemoDb): DashboardSummary {
  return {
    totalPosition: { amount: db.privateTotal, assetCode: "USDC" },
    pendingApprovals: db.payments.filter((p) => p.status === "needs_approval").length,
    openInvoices: db.invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled").length,
    scheduledPayrolls: db.payrollRuns.filter((p) => p.status === "ready" || p.status === "running" || p.status === "paused").length,
    recentActivity: db.dashboardActivity,
    live: true,
  };
}
