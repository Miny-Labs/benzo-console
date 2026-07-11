import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleProvider, useConsole } from "./store";

const apiMock = vi.hoisted(() => ({
  session: vi.fn(),
  live: vi.fn(),
  dashboard: vi.fn(),
  orgTreasury: vi.fn(),
  payments: vi.fn(),
  payrolls: vi.fn(),
  invoices: vi.fn(),
  grants: vi.fn(),
  counterparties: vi.fn(),
  accounts: vi.fn(),
  members: vi.fn(),
  policies: vi.fn(),
}));

vi.mock("./api", () => ({
  api: apiMock,
  AUTH_CHANGED_EVENT: "benzo:console-auth-changed",
  sessionWithActiveOrg: (session: any, id: string) => {
    const activeOrg = session.orgs.find((org: any) => org.id === id) ?? null;
    return { ...session, activeOrg, role: activeOrg?.role ?? null };
  },
}));
vi.mock("../demo/flag", () => ({ DEMO_MODE: false }));

function Probe() {
  const { treasury, loading } = useConsole();
  return (
    <>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="treasury">{treasury?.address ?? "none"}</div>
    </>
  );
}

describe("ConsoleProvider treasury read model", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    apiMock.live.mockResolvedValue({ live: true, mode: "live", missing: [] });
    apiMock.dashboard.mockResolvedValue({ totalPosition: { amount: "0", assetCode: "USDC" }, pendingApprovals: 0, openInvoices: 0, scheduledPayrolls: 0, recentActivity: [], live: true });
    apiMock.orgTreasury.mockResolvedValue({
      address: "0xtreasury",
      custody: "managed",
      registered: true,
      consented: true,
      custodyConsent: { consented: true, consentedAt: "2026-07-01T00:00:00.000Z", consentedBy: "usr_1" },
      balances: [],
    });
    apiMock.payments.mockResolvedValue([]);
    apiMock.payrolls.mockResolvedValue([]);
    apiMock.invoices.mockResolvedValue([]);
    apiMock.grants.mockResolvedValue([]);
    apiMock.counterparties.mockResolvedValue([]);
    apiMock.accounts.mockResolvedValue([]);
    apiMock.members.mockResolvedValue([]);
    apiMock.policies.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("loads treasury through the active org", async () => {
    apiMock.session.mockResolvedValue({
      user: { id: "usr_1", address: "0xowner", roles: ["owner"] },
      orgs: [{ id: "org_1", name: "Acme", slug: "acme", role: "owner", createdAt: "2026-07-01T00:00:00.000Z" }],
      activeOrg: { id: "org_1", name: "Acme", slug: "acme", role: "owner", createdAt: "2026-07-01T00:00:00.000Z" },
      role: "owner",
    });

    render(
      <ConsoleProvider>
        <Probe />
      </ConsoleProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(apiMock.orgTreasury).toHaveBeenCalledWith("org_1");
    expect(screen.getByTestId("treasury")).toHaveTextContent("0xtreasury");
  });

  it("leaves treasury null when there is no active org", async () => {
    apiMock.session.mockResolvedValue({
      user: { id: "usr_1", address: "0xowner", roles: [] },
      orgs: [],
      activeOrg: null,
      role: null,
    });

    render(
      <ConsoleProvider>
        <Probe />
      </ConsoleProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(apiMock.orgTreasury).not.toHaveBeenCalled();
    expect(screen.getByTestId("treasury")).toHaveTextContent("none");
  });
});
