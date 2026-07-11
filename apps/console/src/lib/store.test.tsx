import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleProvider, useConsole } from "./store";

const apiMock = vi.hoisted(() => ({
  session: vi.fn(),
  live: vi.fn(),
  dashboard: vi.fn(),
  orgTreasury: vi.fn(),
  payments: vi.fn(),
  invoices: vi.fn(),
  grants: vi.fn(),
  counterparties: vi.fn(),
  accounts: vi.fn(),
  members: vi.fn(),
  policies: vi.fn(),
}));

const authMock = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message = `http ${status}`) {
      super(message);
      this.status = status;
      this.name = "ApiError";
    }
  }
  return { ApiError, notifyAuthRequired: vi.fn() };
});

vi.mock("./api", () => ({
  api: apiMock,
  ApiError: authMock.ApiError,
  AUTH_CHANGED_EVENT: "benzo:console-auth-changed",
  AUTH_REQUIRED_EVENT: "benzo:console-auth-required",
  notifyAuthRequired: authMock.notifyAuthRequired,
  sessionWithActiveOrg: (session: any, id: string) => {
    const activeOrg = session.orgs.find((org: any) => org.id === id) ?? null;
    return { ...session, activeOrg, role: activeOrg?.role ?? null };
  },
}));
vi.mock("../demo/flag", () => ({ DEMO_MODE: false }));

function Probe() {
  const { treasury, loading, error, session } = useConsole();
  return (
    <>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="treasury">{treasury?.address ?? "none"}</div>
      <div data-testid="error">{error ?? ""}</div>
      <div data-testid="session">{session ? "yes" : "no"}</div>
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

  it("does not sign out on a transient session failure (stays on the loading screen)", async () => {
    // A network blip / 5xx / timeout — NOT a 401 — must not strand the session on
    // sign-in: no logout, and RootGate keeps showing "Loading workspace…" (loading
    // stays true while session is still null), so the boot retry can recover.
    apiMock.session.mockRejectedValue(new Error("network blip"));

    render(
      <ConsoleProvider>
        <Probe />
      </ConsoleProvider>,
    );

    await waitFor(() => expect(apiMock.session).toHaveBeenCalled());
    expect(authMock.notifyAuthRequired).not.toHaveBeenCalled();
    expect(screen.getByTestId("session")).toHaveTextContent("no");
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
  });

  it("signs out through notifyAuthRequired on a confirmed 401", async () => {
    apiMock.session.mockRejectedValue(new authMock.ApiError(401));

    render(
      <ConsoleProvider>
        <Probe />
      </ConsoleProvider>,
    );

    await waitFor(() => expect(authMock.notifyAuthRequired).toHaveBeenCalled());
  });
});
