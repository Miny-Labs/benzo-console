import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./Settings";

const refreshMock = vi.hoisted(() => vi.fn(async () => true));

// A workspace with one member, one seeded approval policy (release gate = 1
// treasurer over $5,000) so the simplified policy control has something to edit.
const stateRef = vi.hoisted(() => ({
  current: {
    session: { org: { name: "Acme", legalName: "Acme Inc.", country: "US", kybStatus: "verified" }, member: { name: "Jane Doe" } },
    members: [{ id: "mem_1", name: "Jane Doe", email: "jane@acme.com", role: "owner", status: "active" }],
    counterparties: [],
    policies: [
      {
        id: "pol_1",
        orgId: "org_1",
        name: "Default",
        conditions: [{ field: "amount", operator: "gte", value: "5000000000" }],
        steps: [{ role: "approver", mode: "any", minApprovers: 1 }],
        releaseGate: { role: "treasurer", mode: "all", minApprovers: 1 },
        reApprovalTriggers: [],
        createdAt: "2026-06-26T00:00:00.000Z",
      },
    ],
    loading: false,
    refresh: refreshMock,
  } as any,
}));

const apiMock = vi.hoisted(() => ({
  integrations: vi.fn(async () => []),
  recoveryStatus: vi.fn(async () => ({ recovery: { bound: true, nextSteps: [] } })),
  invites: vi.fn(async () => []),
  createInvite: vi.fn(async (body: unknown) => ({
    id: "invite_new",
    kind: "member",
    link: "https://console.benzo.space/claim#t=abc",
    token: "abc",
    status: "sent",
    createdAt: "2026-06-26T00:00:00.000Z",
    requestBody: body,
  })),
  updatePolicy: vi.fn(async () => ({})),
  revokeInvite: vi.fn(async () => ({})),
}));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../lib/store", () => ({ useConsole: () => stateRef.current }));

describe("Settings consolidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the full roles matrix behind a 'see full matrix' expander", async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(apiMock.invites).toHaveBeenCalled());

    // Per-role blurbs are the everyday read.
    expect(screen.getByTestId("role-blurb-owner")).toBeInTheDocument();
    expect(screen.getByTestId("role-blurb-auditor")).toBeInTheDocument();
    // The full matrix is collapsed until asked for.
    expect(screen.queryByTestId("roles-full-matrix")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("roles-matrix-toggle"));

    expect(screen.getByTestId("roles-full-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("perm-owner-org.manage")).toBeInTheDocument();
  });

  it("creates a team invite scoped to a console seat", async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(apiMock.invites).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("team-invite-open"));
    fireEvent.change(screen.getByTestId("team-invite-email"), { target: { value: "cfo@acme.com" } });
    fireEvent.change(screen.getByTestId("team-invite-role"), { target: { value: "treasurer" } });
    fireEvent.click(screen.getByTestId("team-invite-create"));

    await waitFor(() => expect(apiMock.createInvite).toHaveBeenCalledOnce());
    expect(apiMock.createInvite).toHaveBeenCalledWith({
      kind: "member",
      name: undefined,
      email: "cfo@acme.com",
      role: "treasurer",
    });
  });

  it("blocks an invite with a missing email before calling the API", async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(apiMock.invites).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("team-invite-open"));
    fireEvent.click(screen.getByTestId("team-invite-create"));

    expect(apiMock.createInvite).not.toHaveBeenCalled();
    expect(screen.getByTestId("team-invite-error")).toHaveTextContent("email");
  });

  it("edits the primary policy through the simplified require-N-over-$X control", async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(apiMock.invites).toHaveBeenCalled());

    // Save is disabled until the control is dirty.
    expect(screen.getByTestId("approval-policy-save")).toBeDisabled();
    // Bump the required approvals from 1 to 2.
    fireEvent.click(screen.getByLabelText("More approvals"));
    fireEvent.click(screen.getByTestId("approval-policy-save"));

    await waitFor(() => expect(apiMock.updatePolicy).toHaveBeenCalledOnce());
    expect(apiMock.updatePolicy).toHaveBeenCalledWith(
      "pol_1",
      expect.objectContaining({ releaseGate: expect.objectContaining({ minApprovers: 2 }) }),
    );
  });
});
