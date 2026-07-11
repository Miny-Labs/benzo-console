/**
 * The BFF <-> console contract: request/response DTOs + the endpoint registry.
 * The console UI imports these so screens are typed against the API, and the
 * BFF implements them. Composite "view" DTOs (DashboardSummary, TreasuryView)
 * are read-optimized projections the dashboard renders directly.
 */
import type { Account, Counterparty } from "./accounts.js";
import type { Approval, ApprovalPolicy } from "./approvals.js";
import type { ComplianceZone, DisclosureTier, GrantScope, ViewingGrant } from "./compliance.js";
import type { EvmAddress, Money, Timestamp } from "./common.js";
import type { Integration, IntegrationProvider } from "./integrations.js";
import type { Invoice, LineItem } from "./invoices.js";
import type { LedgerEntry } from "./ledger.js";
import type { Member, OrgRole, OrgSummary, Role } from "./org.js";
import type { PaymentOrder, PaymentType } from "./payments.js";
import type { CreatePayrollRunResponse, PayrollRunResponse } from "./payroll.js";

// ---- auth / session -------------------------------------------------------

export interface AppUser {
  id: string;
  address: string;
  roles: string[];
}

export interface AppSession {
  user: AppUser;
  orgs: OrgSummary[];
  activeOrg: OrgSummary | null;
  role: OrgRole | null;
}

export type AuthSession = AppSession;

// ---- org creation / eERC onboarding --------------------------------------

export interface CreateOrgRequest {
  name: string;
  slug: string;
}

export interface CreateOrgResponse {
  org: OrgSummary;
  role: "owner";
}

export type OnboardingLifecycleStatus =
  | "pending_kyc"
  | "kyc_approved"
  | "allowlisted"
  | "gas_dripped"
  | "awaiting_registration"
  | "complete"
  | "failed";

export interface OnboardingStatus {
  id: string;
  userId: string;
  address: EvmAddress;
  chainEnv: string;
  chainId: number;
  status: OnboardingLifecycleStatus;
  error: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  mockKyc: {
    approvedAt: Timestamp;
    payload: Record<string, unknown>;
    provider: string;
  } | null;
  steps: {
    kyc: { completedAt: Timestamp | null; provider: string | null };
    allowlist: { completedAt: Timestamp | null; result: unknown | null; txHash: string | null };
    gas: { completedAt: Timestamp | null; result: unknown | null; txHash: string | null };
    registration: { completedAt: Timestamp | null; lastCheckedAt: Timestamp | null };
  };
}

export interface StartOnboardingResponse {
  jobId: string;
  onboarding: OnboardingStatus;
}

export interface OnboardingStatusResponse {
  onboarding: OnboardingStatus;
}

export interface ProvisionTreasuryResponse {
  address: EvmAddress;
  custody: "managed";
  registered: boolean;
  consented: boolean;
  registrationTxHash: string | null;
}

// ---- dashboard / treasury (read-optimized projections) --------------------

export interface ActivityItem {
  id: string;
  kind: "payment" | "invoice" | "payroll" | "deposit" | "withdrawal" | "grant";
  title: string;
  status: string;
  /** display amount (may be "Private" when the viewer can't decode) */
  amountLabel: string;
  at: Timestamp;
}

export interface DashboardSummary {
  /** total shielded position the caller can decode, minor units */
  totalPosition: Money;
  /** count of items awaiting THIS member's approval */
  pendingApprovals: number;
  /** open invoices + scheduled payroll counts */
  openInvoices: number;
  scheduledPayrolls: number;
  recentActivity: ActivityItem[];
  /** TRUE when the BFF is serving real on-chain data. */
  live: boolean;
}

/** GET /api/live — is the BFF wired to live testnet, and if not, why. */
export interface LiveStatusResponse {
  live: boolean;
  mode: "live" | "unavailable";
  /** env vars that are missing/blocking live mode (empty when live). */
  missing: string[];
}

export type TreasuryToken = "usdc" | "eurc";

export interface TreasuryCustodyConsent {
  consented: boolean;
  consentedAt: Timestamp | null;
  consentedBy: string | null;
}

export interface TreasuryBalanceView {
  token: TreasuryToken;
  tokenId: string;
  symbol: string;
  decimals: number;
  /** encrypted token balance, minor units */
  amount: string;
}

export interface TreasuryView {
  address: EvmAddress;
  custody: "managed";
  registered: boolean;
  consented: boolean;
  custodyConsent: TreasuryCustodyConsent;
  balances: TreasuryBalanceView[];
}

export interface DepositToTreasuryRequest {
  /** minor units; must match ^[1-9][0-9]*$ */
  amount: string;
  token: TreasuryToken;
  idempotencyKey: string;
}

export interface DepositToTreasuryResponse {
  amount: string;
  approvalTxHash?: string;
  source: "direct";
  status: "confirmed" | "submitted";
  token: TreasuryToken;
  tokenId: string;
  txHash: string;
}

export interface TreasuryDeposit {
  id: string;
  kind: "direct" | "cctp";
  amount: string;
  token: TreasuryToken;
  status: "pending" | "credited" | "failed";
  txHash: string;
  sourceChain: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TreasuryDepositsResponse {
  deposits: TreasuryDeposit[];
  nextCursor?: string;
}

// ---- request DTOs ---------------------------------------------------------

export interface CreatePaymentRequest {
  type: PaymentType;
  fromAccountId: string;
  toCounterpartyId: string;
  amount: Money;
  memo?: string;
  ref?: string;
  /** route through the gasless relayer */
  useRelayer?: boolean;
}

export interface ApproveRequest {
  decision: "approved" | "denied";
  comment?: string;
}

export interface CreateInvoiceRequest {
  counterpartyId: string;
  number?: string;
  lineItems: LineItem[];
  assetCode: string;
  dueDate?: string;
  /** Idempotency key from an external invoice source, e.g. a wallet handoff. */
  externalId?: string;
  /** Optional payee metadata supplied by a contractor handoff. */
  counterpartyName?: string;
  handle?: string;
}

export interface CreateCounterpartyRequest {
  name: string;
  type: Counterparty["type"];
  email?: string;
  /** when omitted, the BFF mints a self-serve onboarding invite link */
  invite?: boolean;
}

export interface CreateApprovalPolicyRequest {
  name: string;
  policy: Omit<ApprovalPolicy, "id" | "orgId" | "createdAt">;
}

export interface InviteMemberRequest {
  email: string;
  role: Role;
}

export interface ProvisionTreasuryRequest {
  consent: true;
}

export interface CreateViewingGrantRequest {
  auditorName: string;
  auditorPubKey: string;
  tier: DisclosureTier;
  scope: GrantScope;
  /** ISO timestamp */
  expiry: Timestamp;
}

export interface ConnectIntegrationRequest {
  provider: IntegrationProvider;
  /** OAuth/public token or linked-account token */
  token?: string;
}

export interface ProveBalanceRequest {
  /** threshold to prove >= , minor units */
  min: string;
}

export interface ProveBalanceResponse {
  /** the org holds at least `min` (proof attached) */
  holds: boolean;
  proof: string;
  /** TRUE => real Groth16 proof from testnet; false => no on-chain proof. */
  onChain: boolean;
}

// ---- endpoint registry (method + path template) ---------------------------

export interface Endpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
}

/** The canonical REST surface. `:id` segments are path params. */
export const ENDPOINTS = {
  authNonce: { method: "GET", path: "/api/auth/nonce" },
  authVerify: { method: "POST", path: "/api/auth/verify" },
  session: { method: "GET", path: "/api/auth/me" },
  authLogout: { method: "POST", path: "/api/auth/logout" },
  orgs: { method: "GET", path: "/api/orgs" },
  createOrg: { method: "POST", path: "/api/orgs" },
  org: { method: "GET", path: "/api/orgs/:id" },
  onboardingStart: { method: "POST", path: "/api/onboarding/start" },
  onboardingStatus: { method: "GET", path: "/api/onboarding/status" },
  onboardingStatusStream: { method: "GET", path: "/api/onboarding/status/stream" },
  provisionTreasury: { method: "POST", path: "/api/orgs/:id/treasury" },
  orgTreasury: { method: "GET", path: "/api/orgs/:id/treasury" },
  depositToTreasury: { method: "POST", path: "/api/orgs/:id/treasury/deposit" },
  treasuryDeposits: { method: "GET", path: "/api/orgs/:id/treasury/deposits" },
  dashboard: { method: "GET", path: "/api/dashboard" },

  members: { method: "GET", path: "/api/members" },
  inviteMember: { method: "POST", path: "/api/members" },

  accounts: { method: "GET", path: "/api/accounts" },

  counterparties: { method: "GET", path: "/api/counterparties" },
  createCounterparty: { method: "POST", path: "/api/counterparties" },

  payments: { method: "GET", path: "/api/payments" },
  createPayment: { method: "POST", path: "/api/payments" },
  payment: { method: "GET", path: "/api/payments/:id" },
  approvePayment: { method: "POST", path: "/api/payments/:id/approve" },

  invoices: { method: "GET", path: "/api/invoices" },
  createInvoice: { method: "POST", path: "/api/invoices" },

  createPayrollRun: { method: "POST", path: "/api/orgs/:id/payroll" },
  payrollRun: { method: "GET", path: "/api/payroll/:runId" },
  startPayrollRun: { method: "POST", path: "/api/payroll/:runId/start" },
  pausePayrollRun: { method: "POST", path: "/api/payroll/:runId/pause" },
  resumePayrollRun: { method: "POST", path: "/api/payroll/:runId/resume" },

  policies: { method: "GET", path: "/api/policies" },
  createPolicy: { method: "POST", path: "/api/policies" },

  grants: { method: "GET", path: "/api/grants" },
  createGrant: { method: "POST", path: "/api/grants" },
  revokeGrant: { method: "POST", path: "/api/grants/:id/revoke" },

  zones: { method: "GET", path: "/api/compliance/zones" },

  ledger: { method: "GET", path: "/api/ledger" },
  auditLog: { method: "GET", path: "/api/audit" },

  integrations: { method: "GET", path: "/api/integrations" },
  connectIntegration: { method: "POST", path: "/api/integrations" },
} as const satisfies Record<string, Endpoint>;

// ---- response aliases (entity returns) ------------------------------------

export type MembersResponse = Member[];
export type AccountsResponse = Account[];
export type CounterpartiesResponse = Counterparty[];
export type PaymentsResponse = PaymentOrder[];
export type InvoicesResponse = Invoice[];
export type CreatePayrollRunApiResponse = CreatePayrollRunResponse;
export type PayrollRunApiResponse = PayrollRunResponse;
export type PoliciesResponse = ApprovalPolicy[];
export type GrantsResponse = ViewingGrant[];
export type ZonesResponse = ComplianceZone[];
export type LedgerResponse = LedgerEntry[];
export type IntegrationsResponse = Integration[];
export type ApprovalsResponse = Approval[];
