import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEND_PHASE_FLOOR_MS } from "@benzo/ui/send-sequence";
import { Treasury } from "./Treasury";

const apiMock = vi.hoisted(() => ({
  treasuryPublicBalance: vi.fn(async () => ({ units: "500000000", address: "0xpub", asset: "USDC", issuer: "0xiss", live: true })),
  fundTreasury: vi.fn(),
  proveBalance: vi.fn(),
  proveTotal: vi.fn(),
  proveSolvency: vi.fn(),
}));
const refreshMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../lib/store", () => ({
  useConsole: () => ({
    treasury: { totalHidden: { amount: "1230000000", assetCode: "USDC" }, accounts: [] },
    masked: false,
    loading: false,
    refresh: refreshMock,
  }),
}));

describe("Treasury", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the full-screen shield cinematic for Make private", async () => {
    apiMock.fundTreasury.mockReturnValueOnce(new Promise(() => {})); // stays in flight
    render(<Treasury />);

    fireEvent.click(screen.getByTestId("fund-treasury")); // opens the confirm modal
    fireEvent.click(screen.getByTestId("fund-confirm")); // fires the shield ceremony

    const ceremony = await screen.findByTestId("send-ceremony");
    expect(ceremony).toHaveTextContent("Move to private balance");
    expect(screen.getByRole("heading", { name: "Encrypting your payment" })).toBeInTheDocument();
    expect(apiMock.fundTreasury).toHaveBeenCalledWith("0.20");
  });

  it("consolidates the three prove cards into one auditor-disclose action", async () => {
    render(<Treasury />);
    await act(async () => {}); // flush the mount-time public-balance load

    // The three former prove buttons are gone; one shared action remains.
    expect(screen.queryByTestId("prove-balance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prove-total")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prove-solvency")).not.toBeInTheDocument();
    expect(screen.getByTestId("prove-auditor")).toBeInTheDocument();

    // Reserves is the default disclosure, so the floor input is shown…
    expect(screen.getByTestId("prove-min")).toBeInTheDocument();
    // …and hidden once a note-based disclosure is picked.
    fireEvent.click(screen.getByTestId("disclose-solvency"));
    expect(screen.queryByTestId("prove-min")).not.toBeInTheDocument();
  });

  it("navigates the disclosure radiogroup with arrow keys and roving tabindex", async () => {
    render(<Treasury />);
    await act(async () => {}); // flush the mount-time public-balance load

    const reserves = screen.getByTestId("disclose-reserves");
    const total = screen.getByTestId("disclose-total");
    // Reserves is the selected single tab stop; the others are out of tab order.
    expect(reserves).toHaveAttribute("aria-checked", "true");
    expect(reserves).toHaveAttribute("tabindex", "0");
    expect(total).toHaveAttribute("tabindex", "-1");

    // ArrowDown moves selection (and the tab stop) to the next option.
    fireEvent.keyDown(reserves, { key: "ArrowDown" });
    expect(total).toHaveAttribute("aria-checked", "true");
    expect(total).toHaveAttribute("tabindex", "0");
    expect(reserves).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByTestId("prove-min")).not.toBeInTheDocument();

    // ArrowUp wraps back to reserves.
    fireEvent.keyDown(total, { key: "ArrowUp" });
    expect(reserves).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("prove-min")).toBeInTheDocument();
  });

  it("keeps a confirmed shield confirmed even if the post-settle refresh fails", async () => {
    vi.useFakeTimers();
    apiMock.fundTreasury.mockResolvedValueOnce({ onChain: true, txHash: "0xabc" });
    refreshMock.mockRejectedValueOnce(new Error("network hiccup")); // transient refresh error

    render(<Treasury />);
    fireEvent.click(screen.getByTestId("fund-treasury"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("fund-confirm"));
    });

    // Walk the ceremony floors to the verified receipt.
    await act(async () => {
      vi.advanceTimersByTime(SEND_PHASE_FLOOR_MS.encrypt);
    });
    await act(async () => {
      vi.advanceTimersByTime(SEND_PHASE_FLOOR_MS.settle);
    });

    // The refresh rejected, but the settled shield still shows its receipt — not a failure.
    expect(screen.getByText("Moved to Private on-chain")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Couldn't send" })).not.toBeInTheDocument();
  });

  it("runs the picked disclosure through the shared ceremony", async () => {
    apiMock.proveSolvency.mockReturnValueOnce(new Promise(() => {})); // stays in flight
    render(<Treasury />);

    fireEvent.click(screen.getByTestId("disclose-solvency"));
    fireEvent.click(screen.getByTestId("prove-auditor"));

    const ceremony = await screen.findByTestId("send-ceremony");
    expect(ceremony).toHaveTextContent("Prove to an auditor");
    expect(apiMock.proveSolvency).toHaveBeenCalledTimes(1);
    expect(apiMock.proveTotal).not.toHaveBeenCalled();
    expect(apiMock.proveBalance).not.toHaveBeenCalled();
  });

  it("flips the Merkle root into view on the verified reveal", async () => {
    vi.useFakeTimers();
    apiMock.proveBalance.mockResolvedValueOnce({
      holds: true,
      onChain: true,
      minUnits: "100000000000",
      ref: { label: "Reserves proof", verified: true, root: "0xabc123def456", txHash: "0xdeadbeef", network: "fuji" },
    });
    render(<Treasury />);

    // Reserves is the default disclosure; the batched dispatch collapses the
    // machine to confirmed, but the ceremony still walks encrypt -> settle -> verify.
    await act(async () => {
      fireEvent.click(screen.getByTestId("prove-auditor"));
    });
    expect(screen.getByRole("heading", { name: "Encrypting your payment" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(SEND_PHASE_FLOOR_MS.encrypt);
    });
    expect(screen.getByRole("heading", { name: "Settling securely" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(SEND_PHASE_FLOOR_MS.settle);
    });
    expect(screen.getByTestId("prove-merkle-root")).toHaveTextContent("0xabc123def456");
    expect(apiMock.proveBalance).toHaveBeenCalledTimes(1);
  });
});
