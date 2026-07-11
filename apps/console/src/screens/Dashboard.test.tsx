import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

const stateRef = vi.hoisted(() => ({ current: {} as any }));

vi.mock("../lib/store", () => ({
  useConsole: () => stateRef.current,
}));

describe("Dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    stateRef.current = {
      dashboard: {
        live: true,
        totalPosition: { amount: "1230000000", assetCode: "USDC" },
        pendingApprovals: 0,
        openInvoices: 0,
        scheduledPayrolls: 0,
        recentActivity: [],
      },
      treasury: {
        address: "0xtreasury",
        custody: "managed",
        registered: true,
        consented: true,
        custodyConsent: { consented: true, consentedAt: "2026-07-01T00:00:00.000Z", consentedBy: "usr_1" },
        balances: [{ token: "usdc", tokenId: "avax-usdc", symbol: "USDC", decimals: 6, amount: "1230000000" }],
      },
      payments: [],
      members: [],
      policies: [],
      counterparties: [],
      masked: true,
      loading: false,
      error: null,
      refresh: vi.fn(async () => true),
    };
  });

  it("masks the primary treasury total when amount masking is enabled", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("treasury-total")).toHaveTextContent("••••••");
    expect(screen.queryByText("$123.00")).not.toBeInTheDocument();
  });

  it("collapses setup into a compact banner: one remaining step, its CTA, and a completed-steps disclosure", () => {
    // Everything is done except the approval policy → "1 step remaining".
    stateRef.current = {
      ...stateRef.current,
      treasury: {
        address: "0xtreasury",
        custody: "managed",
        registered: true,
        consented: true,
        custodyConsent: { consented: true, consentedAt: "2026-07-01T00:00:00.000Z", consentedBy: "usr_1" },
        balances: [{ token: "usdc", tokenId: "avax-usdc", symbol: "USDC", decimals: 6, amount: "1230000000" }],
      },
      members: [
        { id: "m_owner", role: "owner", status: "active" },
        { id: "m_approver", role: "approver", status: "active" },
      ],
      counterparties: [{ id: "cp1", type: "contractor" }],
      dashboard: { ...stateRef.current.dashboard, scheduledPayrolls: 1 },
      policies: [],
      masked: false,
    };

    function PathProbe() {
      return <span data-testid="path">{useLocation().pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Dashboard />
        <Routes>
          <Route path="*" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const banner = screen.getByTestId("firstrun-checklist");
    // Copy is data-driven: exactly one step (the approval policy) is left.
    expect(banner).toHaveTextContent("1 step remaining");
    expect(banner).toHaveTextContent("Review and activate your approval policy");

    // The single primary CTA routes to the approval policy on Settings.
    fireEvent.click(screen.getByTestId("firstrun-policy"));
    expect(screen.getByTestId("path")).toHaveTextContent("/settings");

    // The four finished steps are disclosed (not struck through) as "Completed".
    expect(banner).toHaveTextContent("Show completed steps (4)");
    fireEvent.click(screen.getByTestId("firstrun-toggle-done"));
    expect(screen.getByTestId("firstrun-done-fund")).toHaveTextContent("Fund your treasury");
    expect(screen.getByTestId("firstrun-done-fund")).toHaveTextContent("Completed");
  });
});
