import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Payroll } from "./Payroll";

const apiMock = vi.hoisted(() => ({
  proveFunded: vi.fn(),
  provePolicy: vi.fn(),
  proveComputation: vi.fn(),
  proveApproval: vi.fn(),
  approvePayroll: vi.fn(),
  createPayroll: vi.fn(),
}));
const refreshMock = vi.hoisted(() => vi.fn(async () => {}));
// Mutable store the mocked hooks read, so each test picks its own fixtures.
const store = vi.hoisted(() => ({
  value: { payrolls: [] as unknown[], counterparties: [] as unknown[], masked: false, refresh: refreshMock, loading: false },
}));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../lib/store", () => ({
  useConsole: () => store.value,
  useCounterpartyName: () => (id?: string) =>
    (store.value.counterparties as Array<{ id: string; name: string }>).find((c) => c.id === id)?.name ?? "Unknown",
}));

const shielded = (handle: string) => ({ paymentAddress: { shielded: handle } });
const batch = {
  id: "pr_1",
  orgId: "org_1",
  period: "2026-06",
  source: "manual",
  status: "needs_approval",
  total: { amount: "9000000000", assetCode: "USDC" },
  createdAt: "2026-06-01T00:00:00.000Z",
  lines: [
    { counterpartyId: "cp_1", amount: "5000000000", status: "pending" },
    { counterpartyId: "cp_2", amount: "4000000000", status: "pending" },
  ],
};
const payableCounterparties = [
  { id: "cp_1", type: "contractor", name: "Ava", status: "allowlisted", payRate: { amount: "5000000000", assetCode: "USDC" }, ...shielded("@ava") },
  { id: "cp_2", type: "contractor", name: "Ben", status: "allowlisted", payRate: { amount: "4000000000", assetCode: "USDC" }, ...shielded("@ben") },
];
const settledBatch = {
  ...batch,
  status: "completed",
  lines: [
    { counterpartyId: "cp_1", amount: "5000000000", status: "paid", txHash: "0xaaa", onChain: true },
    { counterpartyId: "cp_2", amount: "4000000000", status: "paid", txHash: "0xbbb", onChain: true },
  ],
  progress: { required: true, satisfied: true, nextRole: null, nextKind: null, steps: [] },
};
const ref = (label: string, vkId: string) => ({ label, vkId, verified: true, network: "fuji", txHash: "0xproof", publics: [] });

function reducedMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: on && q.includes("reduced-motion"),
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function openConfirmAndRun() {
  fireEvent.click(screen.getByTestId("run-payroll"));
  fireEvent.click(screen.getByTestId("run-payroll-confirm"));
}

describe("Payroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reducedMotion(false);
    apiMock.proveFunded.mockResolvedValue({ onChain: true, funded: true, ref: ref("Payroll funded", "ORGBAL") });
    apiMock.provePolicy.mockResolvedValue({ onChain: true, lines: [] });
    apiMock.proveComputation.mockResolvedValue({ onChain: true, ok: true, ref: ref("Computed from rate card", "PAYCOMP") });
    apiMock.proveApproval.mockResolvedValue({ onChain: true, approved: true, approvers: 2, memberCount: 3, ref: ref("Anonymous approval", "ORGAUTH") });
  });
  afterEach(() => vi.clearAllMocks());

  it("folds the four manual proofs into one animated pass and drops the standalone proof buttons", async () => {
    store.value = { ...store.value, payrolls: [batch], counterparties: payableCounterparties };
    // Hold settlement so the ceremony stays in its proving pass while we assert.
    apiMock.approvePayroll.mockReturnValue(new Promise(() => {}));
    render(<Payroll />);

    // No standalone proof buttons survive on the runnable card.
    expect(screen.queryByTestId("check-policy")).toBeNull();
    expect(screen.queryByTestId("check-funded")).toBeNull();
    expect(screen.queryByTestId("check-approval")).toBeNull();
    expect(screen.queryByTestId("check-computation")).toBeNull();

    openConfirmAndRun();

    const ceremony = await screen.findByTestId("send-ceremony");
    expect(ceremony).toHaveTextContent("Encrypting your payment");
    // Per-recipient progress is driven from the run register.
    expect(within(ceremony).getByText("Ava")).toBeInTheDocument();
    expect(within(ceremony).getByText("Ben")).toBeInTheDocument();

    // The single pass proves funded + policy(cap) + computation before approving.
    await waitFor(() => expect(apiMock.proveFunded).toHaveBeenCalledWith("pr_1"));
    expect(apiMock.provePolicy).toHaveBeenCalledWith("pr_1", "5000.00");
    expect(apiMock.proveComputation).toHaveBeenCalledWith("pr_1");
    await waitFor(() => expect(apiMock.approvePayroll).toHaveBeenCalledWith("pr_1"));
  });

  it("settles honestly and ends on the re-verifiable on-chain receipt", async () => {
    store.value = { ...store.value, payrolls: [batch], counterparties: payableCounterparties };
    apiMock.approvePayroll.mockResolvedValue(settledBatch);
    render(<Payroll />);

    openConfirmAndRun();

    const ceremony = await screen.findByTestId("send-ceremony");
    await waitFor(() => expect(apiMock.approvePayroll).toHaveBeenCalledWith("pr_1"));
    // Final approval also proves the anonymous approver threshold.
    await waitFor(() => expect(apiMock.proveApproval).toHaveBeenCalledWith("pr_1"));

    // The ceremony walks its honest encrypt -> settle -> verify floors, then
    // reveals the receipt with re-verifiable on-chain drill-downs.
    await within(ceremony).findByText("2 paid privately", {}, { timeout: 4000 });
    expect(within(ceremony).getByText("Funded proof")).toBeInTheDocument();
    expect(within(ceremony).getByText("Computation proof")).toBeInTheDocument();
    expect(within(ceremony).getByText("Approval proof")).toBeInTheDocument();
  });

  it("records a non-final approval without claiming a settlement", async () => {
    store.value = { ...store.value, payrolls: [batch], counterparties: payableCounterparties };
    apiMock.approvePayroll.mockResolvedValue({
      ...batch,
      progress: { required: true, satisfied: false, nextRole: "controller", nextKind: "approve", steps: [] },
    });
    render(<Payroll />);

    openConfirmAndRun();

    // The pass ran the pre-flight proofs and the approval, then closed the
    // ceremony instead of animating a settlement that never happened.
    await waitFor(() => expect(apiMock.approvePayroll).toHaveBeenCalledWith("pr_1"));
    expect(apiMock.proveApproval).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("send-ceremony")).toBeNull());
  });

  it("New run pulls the allowlisted roster and computes amounts server-side", async () => {
    store.value = {
      ...store.value,
      payrolls: [],
      counterparties: [
        ...payableCounterparties,
        { id: "cp_3", type: "contractor", name: "Cleo", status: "draft", payRate: { amount: "3000000000", assetCode: "USDC" } },
        { id: "cp_4", type: "customer", name: "Corp", status: "allowlisted", payRate: { amount: "1", assetCode: "USDC" } },
      ],
    };
    apiMock.createPayroll.mockResolvedValue({ ...batch, status: "draft" });
    render(<Payroll />);

    fireEvent.click(screen.getByTestId("new-run"));

    const expectedPeriod = new Date().toISOString().slice(0, 7);
    await waitFor(() =>
      expect(apiMock.createPayroll).toHaveBeenCalledWith({
        period: expectedPeriod,
        source: "manual",
        lines: [{ counterpartyId: "cp_1" }, { counterpartyId: "cp_2" }],
      }),
    );
  });
});
