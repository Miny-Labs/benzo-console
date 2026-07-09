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

  it("plays the intermediate Settling beat even when the machine jumps straight to confirmed", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<SendCeremony open state={{ phase: "building" }} />);

    // A batched dispatch collapses building -> confirmed in a single render.
    rerender(<SendCeremony open state={{ phase: "confirmed" }} />);
    expect(screen.getByRole("heading", { name: "Encrypting your payment" })).toBeInTheDocument();

    // After the encrypt floor, the Settling beat must appear — never skipped,
    // or the ceremony would be lying about settlement.
    await act(async () => {
      vi.advanceTimersByTime(SEND_PHASE_FLOOR_MS.encrypt);
    });
    expect(screen.getByRole("heading", { name: "Settling securely" })).toBeInTheDocument();

    // Only after the settle floor does the verified receipt reveal.
    await act(async () => {
      vi.advanceTimersByTime(SEND_PHASE_FLOOR_MS.settle);
    });
    expect(screen.getByRole("heading", { name: "Sent privately" })).toBeInTheDocument();
  });
});
