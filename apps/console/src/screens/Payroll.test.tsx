import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Payroll } from "./Payroll";

const apiMock = vi.hoisted(() => ({
  createPayrollRun: vi.fn(),
  getPayrollRun: vi.fn(),
  subscribePayrollProgress: vi.fn(),
  startPayrollRun: vi.fn(),
  pausePayrollRun: vi.fn(),
  resumePayrollRun: vi.fn(),
}));

const store = vi.hoisted(() => ({
  value: {
    session: {
      activeOrg: { id: "org_1", name: "Acme", slug: "acme", role: "owner", createdAt: "2026-07-01T00:00:00.000Z" },
    },
    masked: false,
  },
}));

vi.mock("../lib/api", () => ({
  api: apiMock,
  isTreasuryUnderfundedError: (error: unknown) =>
    typeof error === "object"
    && error !== null
    && "body" in error
    && (error as { body?: { error?: string } }).body?.error === "treasury_underfunded",
}));

vi.mock("../lib/store", () => ({
  useConsole: () => store.value,
}));

const progressReady = { total: 1, pending: 1, proving: 0, submitted: 0, confirmed: 0, failed: 0, proved: 0 };
const progressRunning = { total: 1, pending: 0, proving: 1, submitted: 0, confirmed: 0, failed: 0, proved: 0 };
const progressComplete = { total: 1, pending: 0, proving: 0, submitted: 0, confirmed: 1, failed: 0, proved: 1 };
const item = {
  rowIndex: 2,
  recipientInput: "@aisha",
  resolvedAddress: "0x1234567890abcdef1234567890abcdef12345678",
  amount: "8500",
  status: "pending",
  error: null,
};
const runReady = {
  id: "pr_1",
  orgId: "org_1",
  status: "ready",
  itemCount: 1,
  totalAmount: "8500",
  token: "usdc",
  tokenId: "avalanche-fuji:usdc",
  createdBy: "usr_1",
  error: null,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};
const readySnapshot = { run: runReady, progress: progressReady, items: [item] };
const createResponse = {
  runId: "pr_1",
  status: "ready",
  token: "usdc",
  tokenId: "avalanche-fuji:usdc",
  summary: { total: 1, valid: 1, invalid: 0, totalAmount: "8500", token: "usdc", tokenId: "avalanche-fuji:usdc" },
  items: [item],
};

function renderPayroll() {
  return render(
    <MemoryRouter>
      <Payroll />
    </MemoryRouter>,
  );
}

describe("Payroll", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    store.value = {
      session: {
        activeOrg: { id: "org_1", name: "Acme", slug: "acme", role: "owner", createdAt: "2026-07-01T00:00:00.000Z" },
      },
      masked: false,
    };
    apiMock.createPayrollRun.mockResolvedValue(createResponse);
    apiMock.getPayrollRun.mockResolvedValue(readySnapshot);
    apiMock.startPayrollRun.mockResolvedValue({ runId: "pr_1", status: "running", enqueued: true, totalPending: 1, progress: progressRunning });
    apiMock.pausePayrollRun.mockResolvedValue({ runId: "pr_1", status: "paused", progress: progressRunning });
    apiMock.resumePayrollRun.mockResolvedValue({ runId: "pr_1", status: "running", enqueued: true, totalPending: 0, progress: progressRunning });
    apiMock.subscribePayrollProgress.mockReturnValue({ close: vi.fn() });
  });

  it("validates CSV through the org-scoped backend and persists the run id", async () => {
    renderPayroll();

    fireEvent.change(screen.getByTestId("payroll-csv"), { target: { value: "recipient,amount\n@aisha,8500" } });
    fireEvent.click(screen.getByTestId("validate-payroll"));

    await waitFor(() => expect(apiMock.createPayrollRun).toHaveBeenCalledWith("org_1", { csv: "recipient,amount\n@aisha,8500", token: "usdc" }));
    expect(localStorage.getItem("benzo.console.payroll.currentRun:org_1")).toBe("pr_1");
    expect(await screen.findByTestId("payroll-row-2")).toHaveTextContent("@aisha");
    expect(screen.getByTestId("payroll-row-2")).toHaveTextContent("8500 USDC");
    expect(screen.getByText("Valid")).toBeInTheDocument();
  });

  it("reattaches to a persisted running run and subscribes to progress", async () => {
    localStorage.setItem("benzo.console.payroll.currentRun:org_1", "pr_1");
    apiMock.getPayrollRun.mockResolvedValue({
      run: { ...runReady, status: "running" },
      progress: progressRunning,
      items: [{ ...item, status: "proving" }],
    });

    renderPayroll();

    await waitFor(() => expect(apiMock.getPayrollRun).toHaveBeenCalledWith("pr_1"));
    await waitFor(() => expect(apiMock.subscribePayrollProgress).toHaveBeenCalledWith("pr_1", expect.any(Function), expect.any(Function)));
    expect(screen.getByTestId("payroll-progress")).toHaveTextContent("Proving");
  });

  it("starts a ready run and reflects live progress counts", async () => {
    localStorage.setItem("benzo.console.payroll.currentRun:org_1", "pr_1");
    let onProgress: ((event: { runId: string; status: string; progress: typeof progressComplete }) => void) | undefined;
    apiMock.subscribePayrollProgress.mockImplementation((_runId, handler) => {
      onProgress = handler;
      return { close: vi.fn() };
    });

    renderPayroll();
    await screen.findByTestId("payroll-row-2");
    fireEvent.click(screen.getByTestId("start-payroll"));

    await waitFor(() => expect(apiMock.startPayrollRun).toHaveBeenCalledWith("pr_1"));
    await waitFor(() => expect(apiMock.subscribePayrollProgress).toHaveBeenCalled());
    act(() => onProgress?.({ runId: "pr_1", status: "running", progress: progressComplete }));

    expect(screen.getByTestId("progress-confirmed")).toHaveTextContent("1/1");
  });

  it("pauses and resumes an in-flight run", async () => {
    localStorage.setItem("benzo.console.payroll.currentRun:org_1", "pr_1");
    apiMock.getPayrollRun.mockResolvedValue({
      run: { ...runReady, status: "running" },
      progress: progressRunning,
      items: [{ ...item, status: "proving" }],
    });

    renderPayroll();
    await waitFor(() => expect(apiMock.subscribePayrollProgress).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("pause-payroll"));

    await waitFor(() => expect(apiMock.pausePayrollRun).toHaveBeenCalledWith("pr_1"));
    fireEvent.click(screen.getByTestId("resume-payroll"));
    await waitFor(() => expect(apiMock.resumePayrollRun).toHaveBeenCalledWith("pr_1"));
  });

  it("surfaces treasury_underfunded with the shortfall and treasury link", async () => {
    localStorage.setItem("benzo.console.payroll.currentRun:org_1", "pr_1");
    apiMock.startPayrollRun.mockRejectedValue({
      body: {
        error: "treasury_underfunded",
        availableAmount: "10",
        requiredAmount: "12.5",
        token: "usdc",
        tokenId: "avalanche-fuji:usdc",
      },
    });

    renderPayroll();
    await screen.findByTestId("payroll-row-2");
    fireEvent.click(screen.getByTestId("start-payroll"));

    const alert = await screen.findByTestId("underfunded-alert");
    expect(alert).toHaveTextContent("short by 2.5 USDC");
    expect(screen.getByRole("link", { name: /fund treasury/i })).toHaveAttribute("href", "/treasury");
  });
});
