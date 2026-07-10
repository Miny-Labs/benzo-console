import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Grants } from "./Grants";

// Drive the ceremony in its reduced-motion still fallback: framer reads this at
// first render, which short-circuits the honest phase floors (so the end state is
// assertable without timers) and stops the infinite glyph loop from spinning the
// jsdom timer queue. Must be set before framer's lazy init (first render).
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
})) as unknown as typeof window.matchMedia;

const apiMock = vi.hoisted(() => ({
  periodTotalAttestation: vi.fn(),
}));
// Stable references: Grants copies `grants` into state via an effect keyed on it,
// so a fresh array each render would loop forever.
const storeMock = vi.hoisted(() => ({ grants: [], accounts: [], refresh: vi.fn(async () => true), loading: false }));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../lib/store", () => ({ useConsole: () => storeMock }));

describe("Grants period-total cinematic", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("plays one full-screen action ending on a re-verifiable, downloadable attestation", async () => {
    apiMock.periodTotalAttestation.mockResolvedValueOnce({
      live: true,
      onChain: true,
      period: "2026-Q2",
      total: "500000000",
      vkId: "ORGSUM",
      verifier: "0xverifier",
      network: "fuji",
      root: "0xmerkleroot",
      publicInputs: ["500000000"],
    });
    render(<Grants />);

    fireEvent.click(screen.getByText("Attestations"));
    fireEvent.click(screen.getByTestId("gen-period-total"));
    expect(screen.getByTestId("send-ceremony")).toBeInTheDocument();
    expect(apiMock.periodTotalAttestation).toHaveBeenCalledWith("2026-Q2");

    // Ends on the verified, re-verifiable attestation.
    expect(await screen.findByRole("heading", { name: /Verified on-chain/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download attestation/ })).toBeInTheDocument();
  });

  it("fails clearly instead of claiming a total that never verified on-chain", async () => {
    apiMock.periodTotalAttestation.mockResolvedValueOnce({
      live: true,
      onChain: false,
      total: "0",
      publicInputs: [],
    });
    render(<Grants />);

    fireEvent.click(screen.getByText("Attestations"));
    fireEvent.click(screen.getByTestId("gen-period-total"));

    // Fails on its own headline; the reason shows in both the sub and the receipt.
    expect(await screen.findByRole("heading", { name: /Couldn't prove the total/ })).toBeInTheDocument();
    expect(screen.getAllByText(/No private payroll notes exist for this period/).length).toBeGreaterThan(0);
    // Honesty: no on-chain proof means no downloadable attestation.
    expect(screen.queryByRole("button", { name: /Download attestation/ })).not.toBeInTheDocument();
  });
});
