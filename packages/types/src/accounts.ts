import type {
  AccountId,
  CounterpartyId,
  EvmAddress,
  Money,
  OrgId,
  Timestamp,
} from "./common.js";
import type { PaymentAddress } from "./org.js";

/** Internal ledger account kinds an org operates. */
export type AccountType = "operating" | "payroll" | "treasury";

/** An internal account, a named bucket of shielded value the ledger tracks. */
export interface Account {
  id: AccountId;
  orgId: OrgId;
  name: string;
  type: AccountType;
  assetCode: string;
  /** the org's shielded address this account settles into */
  shieldedAddress?: string;
  /** optional public EVM address (for the deposit/withdraw edge) */
  evmAddress?: EvmAddress;
  createdAt: Timestamp;
}

/** How an external account is addressed (the MT-style discriminator). */
export type AccountNumberType = "evm" | "benzo_shielded" | "bank";

export interface ExternalAccount {
  id: string;
  accountNumberType: AccountNumberType;
  /** EVM/shielded address, or a tokenized bank reference */
  address?: string;
  /** masked bank details for display (real details live in the provider) */
  bankLast4?: string;
  bankName?: string;
}

export type CounterpartyType = "vendor" | "contractor" | "employee" | "customer";

/**
 * Compliance lifecycle: a counterparty must be allow-listed + screened before
 * it can receive a payment (maps to Benzo's deposit allow-list / ASP screening).
 */
export type CounterpartyStatus =
  | "draft"
  | "invited"
  | "pending_screening"
  | "allowlisted"
  | "blocked";

/** A payee/payer, a first-class, shared org object. */
export interface Counterparty {
  id: CounterpartyId;
  orgId: OrgId;
  name: string;
  type: CounterpartyType;
  status: CounterpartyStatus;
  email?: string;
  /** shielded payment material a private transfer targets */
  paymentAddress?: PaymentAddress;
  externalAccounts: ExternalAccount[];
  /** stable join key for accounting/ERP sync */
  externalId?: string;
  /** tax form on file */
  taxFormType?: "W9" | "W8-BEN" | "none";
  /**
   * Pay rate card, the source-of-truth a payroll run COMPUTES each line from
   * (server-side, never trusting a caller-supplied amount). v1 = a fixed
   * recurring retainer; hours×rate / milestones are a fast-follow.
   */
  payRate?: Money;
  payCadence?: "monthly";
  createdAt: Timestamp;
}
