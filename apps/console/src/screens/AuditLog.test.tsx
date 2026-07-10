import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLog } from "./AuditLog";

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

const apiMock = vi.hoisted(() => {
  const packet = {
    orgId: "org_test",
    scope: { label: "console-private-events" },
    anchor: {
      orgId: "org_test",
      eventCount: 1,
      headHash: "head_hash",
      merkleRoot: "root_hash_value",
      anchoredAt: "2026-06-26T00:00:00.000Z",
    },
    envelopes: [{ id: "pe_1", hash: "head_hash", prevHash: "GENESIS" }],
    inclusionProofs: [{ eventHash: "head_hash", siblings: [], index: 0 }],
    issuedAt: "2026-06-26T00:00:00.000Z",
  };
  return {
    ledger: vi.fn(async () => []),
    ledgerVerify: vi.fn(async (): Promise<{ ok: boolean; length: number; brokenAt?: number }> => ({ ok: true, length: 1 })),
    privateAuditPacket: vi.fn(async () => ({
      packet,
      integrity: { ok: true, headHash: "head_hash" },
      disclosure: "ciphertext-only",
    })),
    anchorPrivateAuditRoot: vi.fn(async (body?: unknown) => ({
      packet,
      integrity: { ok: true, headHash: "head_hash" },
      packetHash: "packet_hash",
      orgHash: "org_hash",
      disclosure: "only roots/hashes/event counts are submitted on-chain",
      anchor: { onChain: true, sequence: "123", txHash: "tx_hash" },
      ...(body ? { requestBody: body } : {}),
    })),
  };
});

vi.mock("../lib/api", () => ({ api: apiMock }));

describe("AuditLog auditor packet", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("verifies the chain, folds the packet, and anchors the root in one cinematic", async () => {
    render(<AuditLog />);

    fireEvent.click(screen.getByTestId("generate-packet"));
    expect(screen.getByTestId("send-ceremony")).toBeInTheDocument();

    // One action drives verify -> fold -> anchor in order.
    await waitFor(() => expect(apiMock.anchorPrivateAuditRoot).toHaveBeenCalledOnce());
    expect(apiMock.ledgerVerify).toHaveBeenCalledOnce();
    expect(apiMock.privateAuditPacket).toHaveBeenCalledOnce();
    // The freshly built packet is what gets anchored on-chain.
    expect(apiMock.anchorPrivateAuditRoot).toHaveBeenCalledWith({
      packet: expect.objectContaining({
        orgId: "org_test",
        anchor: expect.objectContaining({ eventCount: 1 }),
      }),
    });

    // Ends on the re-verifiable, downloadable packet.
    expect(await screen.findByTestId("packet-receipt")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Anchored on-chain/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download packet/ })).toBeInTheDocument();
  });

  it("stops clearly and never anchors when the chain has been tampered with", async () => {
    apiMock.ledgerVerify.mockResolvedValueOnce({ ok: false, length: 5, brokenAt: 3 });
    render(<AuditLog />);

    fireEvent.click(screen.getByTestId("generate-packet"));

    // Fails clearly on its own headline (shown in both the sub and the receipt).
    expect(await screen.findByRole("heading", { name: /Couldn't seal the packet/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Tampering detected at entry #3/).length).toBeGreaterThan(0);
    // Honesty: a broken chain must not proceed to fold or anchor anything.
    expect(apiMock.privateAuditPacket).not.toHaveBeenCalled();
    expect(apiMock.anchorPrivateAuditRoot).not.toHaveBeenCalled();
  });
});
