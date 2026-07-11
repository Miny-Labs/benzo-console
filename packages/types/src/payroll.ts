import type { OrgId, Timestamp } from "./common.js";

export type PayrollToken = "usdc" | "eurc";

export type PayrollRunStatus =
  | "draft"
  | "validating"
  | "ready"
  | "running"
  | "paused"
  | "complete"
  | "failed";

export type PayrollItemStatus =
  | "pending"
  | "proving"
  | "submitted"
  | "confirmed"
  | "failed";

export interface PayrollRun {
  id: string;
  orgId: OrgId;
  status: PayrollRunStatus;
  itemCount: number;
  totalAmount: string;
  token: PayrollToken;
  tokenId: string;
  createdBy: string;
  error: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PayrollProgressCounts {
  total: number;
  pending: number;
  proving: number;
  submitted: number;
  confirmed: number;
  failed: number;
  proved: number;
}

export interface PayrollRunItem {
  rowIndex: number;
  recipientInput: string;
  resolvedAddress: string | null;
  amount: string;
  status: PayrollItemStatus;
  error: string | null;
}

export interface PayrollRunSummary {
  total: number;
  valid: number;
  invalid: number;
  totalAmount: string;
  token: PayrollToken;
  tokenId: string;
}

export interface CreatePayrollRunRequest {
  csv: string;
  token?: PayrollToken;
}

export interface CreatePayrollRunResponse {
  runId: string;
  status: Extract<PayrollRunStatus, "ready" | "failed">;
  token: PayrollToken;
  tokenId: string;
  summary: PayrollRunSummary;
  items: PayrollRunItem[];
}

export interface PayrollRunResponse {
  run: PayrollRun;
  progress: PayrollProgressCounts;
  items: PayrollRunItem[];
}

export interface PayrollProgressEvent {
  runId: string;
  status: PayrollRunStatus;
  progress: PayrollProgressCounts;
}

export interface StartPayrollRunResponse {
  runId: string;
  status: Extract<PayrollRunStatus, "running">;
  enqueued: boolean;
  totalPending: number;
  progress: PayrollProgressCounts;
}

export interface PausePayrollRunResponse {
  runId: string;
  status: Extract<PayrollRunStatus, "paused">;
  progress: PayrollProgressCounts;
}

export interface ResumePayrollRunResponse {
  runId: string;
  status: Extract<PayrollRunStatus, "running">;
  enqueued: boolean;
  totalPending: number;
  progress: PayrollProgressCounts;
}

export interface TreasuryUnderfundedError {
  error: "treasury_underfunded";
  availableAmount: string;
  requiredAmount: string;
  token: PayrollToken;
  tokenId: string;
}
