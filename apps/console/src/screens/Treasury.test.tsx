import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Treasury } from "./Treasury";

const apiMock = vi.hoisted(() => ({
  depositToTreasury: vi.fn(),
  treasuryDeposits: vi.fn(async () => ({
    deposits: [
      {
        id: "dep_1",
        kind: "direct",
        amount: "25000000",
        token: "usdc",
        status: "credited",
        txHash: "0xabc123",
        sourceChain: "avalanche-fuji",
        createdAt: "2026-07-10T10:00:00.000Z",
        updatedAt: "2026-07-10T10:01:00.000Z",
      },
    ],
  })),
}));
const refreshMock = vi.hoisted(() => vi.fn(async () => true));
const idempotencyMock = vi.hoisted(() => vi.fn(() => "idem_test_1"));
const storeRef = vi.hoisted(() => ({ current: {} as any }));

vi.mock("../lib/api", () => ({ api: apiMock, randomIdempotencyKey: idempotencyMock }));
vi.mock("../lib/store", () => ({
  useConsole: () => storeRef.current,
}));

describe("Treasury", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeRef.current = {
      session: {
        user: { id: "usr_1", address: "0xowner", roles: ["owner"] },
        orgs: [],
        activeOrg: { id: "org_1", name: "Acme", slug: "acme", role: "owner", createdAt: "2026-07-01T00:00:00.000Z" },
        role: "owner",
      },
      treasury: {
        address: "0x1111111111111111111111111111111111111111",
        custody: "managed",
        registered: true,
        consented: true,
        custodyConsent: { consented: true, consentedAt: "2026-07-01T00:00:00.000Z", consentedBy: "usr_1" },
        balances: [
          { token: "usdc", tokenId: "avalanche-fuji:usdc", symbol: "USDC", decimals: 6, amount: "842300000000" },
          { token: "eurc", tokenId: "avalanche-fuji:eurc", symbol: "EURC", decimals: 6, amount: "48250000000" },
        ],
      },
      masked: false,
      loading: false,
      refresh: refreshMock,
    };
  });

  it("renders the managed treasury address, encrypted balances, and deposits", async () => {
    render(<Treasury />);

    expect(screen.getByTestId("treasury-address")).toHaveTextContent("0x1111111111111111111111111111111111111111");
    expect(screen.getByTestId("balance-usdc")).toHaveTextContent("842,300.00 USDC");
    expect(screen.getByTestId("balance-eurc")).toHaveTextContent("48,250.00 EURC");
    expect(await screen.findByTestId("deposit-dep_1")).toHaveTextContent("25.00 USDC");
    expect(apiMock.treasuryDeposits).toHaveBeenCalledWith("org_1", { limit: 10 });

    expect(screen.queryByTestId("receive-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("send-wallet-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prove-auditor")).not.toBeInTheDocument();
  });

  it("adds funds with USDC minor units and a fresh idempotency key", async () => {
    apiMock.depositToTreasury.mockResolvedValueOnce({
      amount: "12340000",
      source: "direct",
      status: "submitted",
      token: "usdc",
      tokenId: "avalanche-fuji:usdc",
      txHash: "0xdep",
    });
    render(<Treasury />);

    fireEvent.change(screen.getByTestId("fund-amount"), { target: { value: "12.34" } });
    fireEvent.click(screen.getByTestId("add-funds"));

    await waitFor(() => {
      expect(apiMock.depositToTreasury).toHaveBeenCalledWith("org_1", {
        amount: "12340000",
        token: "usdc",
        idempotencyKey: "idem_test_1",
      });
    });
    expect(idempotencyMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("deposit-result")).toHaveTextContent("Deposit submitted");
  });

  it("keeps Add funds disabled for non-admin viewers", async () => {
    storeRef.current = {
      ...storeRef.current,
      session: {
        ...storeRef.current.session,
        activeOrg: { ...storeRef.current.session.activeOrg, role: "viewer" },
        role: "viewer",
      },
    };

    render(<Treasury />);
    await screen.findByTestId("deposit-dep_1");
    fireEvent.click(screen.getByTestId("add-funds"));

    expect(screen.getByTestId("add-funds")).toBeDisabled();
    expect(apiMock.depositToTreasury).not.toHaveBeenCalled();
  });
});
