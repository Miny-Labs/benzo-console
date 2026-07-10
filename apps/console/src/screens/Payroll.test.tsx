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
  value: { payrolls: [] as unknown[], counterparties: [] as unknown[], policies: [] as unknown[], masked: false, refresh: refreshMock, loading: false },
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
// A settled run that carries all three folded proofs — used to assert the proof
// detail lives behind the "Technical details" disclosure in the run drawer.
const provenBatch = {
  ...batch,
  id: "pr_done",
  period: "2026-05",
  status: "completed",
  lines: [
    { counterpartyId: "cp_1", amount: "5000000000", status: "paid", txHash: "0xaaa", onChain: true, capProof: { withinCap: true, onChain: true }, screenProof: { innocent: true, onChain: true } },
    { counterpartyId: "cp_2", amount: "4000000000", status: "paid", txHash: "0xbbb", onChain: true, capProof: { withinCap: true, onChain: true }, screenProof: { innocent: true, onChain: true } },
  ],
  fundedProof: { funded: true, onChain: true, provenAt: "2026-05-01T00:00:00.000Z" },
  approvalProof: { approved: true, onChain: true, approvers: 2, threshold: 2, memberCount: 4, provenAt: "2026-05-01T00:00:00.000Z" },
  computationProof: { ok: true, onChain: true, runTotal: "9000000000", provenAt: "2026-05-01T00:00:00.000Z" },
};
// Two distinct approvers required, none recorded yet → this approval is NOT final.
const twoStepPolicy = {
  id: "pol_1",
  orgId: "org_1",
  name: "Payroll",
  conditions: [],
  steps: [{ role: "approver", mode: "all", minApprovers: 2 }],
  reApprovalTriggers: [],
  createdAt: "2026-01-01T00:00:00.000Z",
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
    store.value = { ...store.value, policies: [] };
    apiMock.proveFunded.mockResolvedValue({ onChain: true, funded: true, ref: ref("Payroll funded", "ORGBAL") });
    apiMock.provePolicy.mockResolvedValue({ onChain: true, lines: [] });
    apiMock.proveComputation.mockResolvedValue({ onChain: true, ok: true, ref: ref("Computed from rate card", "PAYCOMP") });
    apiMock.proveApproval.mockResolvedValue({ onChain: true, approved: true, approvers: 2, memberCount: 3, ref: ref("Anonymous approval", "ORGAUTH") });
  });
  afterEach(() => vi.clearAllMocks());

  it("renders a run as a dense table row: human period + one primary status, not the proof-badge cluster", () => {
    store.value = { ...store.value, payrolls: [batch], counterparties: payableCounterparties };
    render(<Payroll />);

    // "2026-06" is humanised, and the process line replaces the long protocol sentence.
    expect(screen.getByText("June 2026 payroll")).toBeInTheDocument();
    expect(screen.getByText("Payroll runs after funding and approval checks pass.")).toBeInTheDocument();

    // One primary approval status per row (awaiting approval) — NOT the three purple
    // proof badges, which now live in the detail drawer's Technical details.
    expect(screen.getByText("awaiting approval")).toBeInTheDocument();
    expect(screen.queryByTestId("funded-badge")).toBeNull();
    expect(screen.queryByTestId("approval-badge")).toBeNull();
    expect(screen.queryByTestId("computation-badge")).toBeNull();

    // Details is a real row action, and the settling action is precisely labelled.
    expect(screen.getByTestId("open-details")).toBeInTheDocument();
    expect(screen.getByTestId("run-payroll")).toHaveTextContent("Approve & run");
  });

  it("labels the action 'Approve' (not 'Approve & run') when this approval isn't the final one", () => {
    // Policy needs two approvers, none recorded — so this click can't settle.
    store.value = { ...store.value, payrolls: [batch], counterparties: payableCounterparties, policies: [twoStepPolicy] };
    render(<Payroll />);

    const btn = screen.getByTestId("run-payroll");
    expect(btn).toHaveTextContent("Approve");
    expect(btn).not.toHaveTextContent("Approve & run");
  });

  it("keeps the proof + anonymous-approval detail behind a Technical details disclosure in the drawer", async () => {
    store.value = { ...store.value, payrolls: [provenBatch], counterparties: payableCounterparties };
    render(<Payroll />);

    // Collapsed by default and gated behind the drawer — no proof claims on the page.
    expect(screen.queryByText("Funding confirmed")).toBeNull();

    fireEvent.click(screen.getByTestId("open-details"));
    // The disclosure header exists, but the crypto detail stays folded until opened.
    const disclosure = await screen.findByTestId("technical-details");
    expect(screen.queryByText("Funding confirmed")).toBeNull();

    fireEvent.click(disclosure);
    // The three claims that used to crowd the row are here, and only here.
    expect(await screen.findByText("Funding confirmed")).toBeInTheDocument();
    expect(screen.getByText("Approval policy satisfied")).toBeInTheDocument();
    expect(screen.getByText("Amounts calculated from rate cards")).toBeInTheDocument();
    // Anonymous approver detail is disclosed here (2-of-4), not on the row.
    expect(screen.getByText(/2-of-4 distinct approvers signed anonymously/)).toBeInTheDocument();
  });

  it("folds the four manual proofs into one animated pass and drops the standalone proof buttons", async () => {
    store.value = { ...store.value, payrolls: [batch], counterparties: payableCounterparties };
    // Hold settlement so the ceremony stays in its proving pass while we assert.
    apiMock.approvePayroll.mockReturnValue(new Promise(() => {}));
    render(<Payroll />);

    // No standalone proof buttons survive on the runnable row.
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
    // Per-recipient progress reads the SETTLED batch, not the pending draft: both
    // lines settled, so the roster reports 2/2 paid (would be 0/2 if stale).
    expect(within(ceremony).getByText("2/2 paid")).toBeInTheDocument();
  });

  it("blocks a policy-violating run before it settles", async () => {
    store.value = { ...store.value, payrolls: [batch], counterparties: payableCounterparties };
    // One line proves OVER the cap on-chain - a provable hard block.
    apiMock.provePolicy.mockResolvedValue({
      onChain: true,
      lines: [
        { counterpartyId: "cp_1", capProof: { withinCap: false, onChain: true } },
        { counterpartyId: "cp_2", capProof: { withinCap: true, onChain: true } },
      ],
    });
    render(<Payroll />);

    openConfirmAndRun();

    const ceremony = await screen.findByTestId("send-ceremony");
    await waitFor(() => expect(apiMock.provePolicy).toHaveBeenCalledWith("pr_1", "5000.00"));
    // The policy result is surfaced (not silently dropped) AND settlement is stopped.
    await waitFor(() => expect(within(ceremony).getAllByText(/Policy blocked/i).length).toBeGreaterThan(0));
    expect(apiMock.approvePayroll).not.toHaveBeenCalled();
    expect(apiMock.proveApproval).not.toHaveBeenCalled();
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
