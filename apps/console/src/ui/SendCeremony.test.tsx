import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_PHASE_FLOOR_MS } from "@benzo/ui/send-sequence";
import { SendCeremony } from "./SendCeremony";

describe("SendCeremony", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the shared send projection with caller-provided details", () => {
    render(
      <SendCeremony
        open
        state={{ phase: "building" }}
        eyebrow="Payroll"
        details={<span>12 payouts</span>}
      />,
    );

    expect(screen.getByTestId("send-ceremony")).toHaveTextContent("Payroll");
    expect(screen.getByRole("heading", { name: "Encrypting your payment" })).toBeInTheDocument();
    expect(screen.getByText("12 payouts")).toBeInTheDocument();
  });

  it("holds an observed phase for its floor before revealing the next phase", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<SendCeremony open state={{ phase: "building" }} />);

    rerender(<SendCeremony open state={{ phase: "confirmed" }} />);
    expect(screen.getByRole("heading", { name: "Encrypting your payment" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(SEND_PHASE_FLOOR_MS.encrypt);
    });

    expect(screen.getByRole("heading", { name: "Sent privately" })).toBeInTheDocument();
  });
});
