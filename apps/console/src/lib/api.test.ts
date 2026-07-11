import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatePaymentRequest, OnboardingStatus } from "@benzo/types";
import { ACTIVE_ORG_KEY, api, apiHref } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function callHeaders(call: unknown[]): Headers {
  return call[1] instanceof Object && "headers" in call[1]
    ? call[1].headers as Headers
    : new Headers();
}

function onboardingStatus(status: OnboardingStatus["status"]): OnboardingStatus {
  return {
    id: "onb_1",
    userId: "usr_1",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    chainEnv: "testnet",
    chainId: 43113,
    status,
    error: status === "failed" ? "failed" : null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:02.000Z",
    mockKyc: null,
    steps: {
      kyc: { completedAt: status === "pending_kyc" ? null : "2026-07-10T00:00:01.000Z", provider: status === "pending_kyc" ? null : "mock" },
      allowlist: { completedAt: ["allowlisted", "gas_dripped", "awaiting_registration", "complete"].includes(status) ? "2026-07-10T00:00:02.000Z" : null, result: null, txHash: null },
      gas: { completedAt: ["gas_dripped", "awaiting_registration", "complete"].includes(status) ? "2026-07-10T00:00:03.000Z" : null, result: null, txHash: null },
      registration: { completedAt: status === "complete" ? "2026-07-10T00:00:04.000Z" : null, lastCheckedAt: ["awaiting_registration", "complete"].includes(status) ? "2026-07-10T00:00:04.000Z" : null },
    },
  };
}

describe("console API idempotency", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reuses a mutation idempotency key after a network failure, then clears it after a response", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({ id: "pay_1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "pay_2" }));
    vi.stubGlobal("fetch", fetchMock);

    const body = {
      type: "shielded_transfer",
      fromAccountId: "acc_operating",
      toCounterpartyId: "cp_vendor",
      amount: { amount: "10000000", assetCode: "USDC" },
    } satisfies CreatePaymentRequest;

    await expect(api.createPayment(body)).rejects.toThrow("network down");
    const firstKey = callHeaders(fetchMock.mock.calls[0]).get("idempotency-key");
    expect(firstKey).toMatch(/^idem_/);

    await api.createPayment(body);
    const retryKey = callHeaders(fetchMock.mock.calls[1]).get("idempotency-key");
    expect(retryKey).toBe(firstKey);
    expect(Object.keys(localStorage).filter((k) => k.startsWith("benzo.idempotency.console.v1:"))).toEqual([]);

    await api.createPayment(body);
    const nextKey = callHeaders(fetchMock.mock.calls[2]).get("idempotency-key");
    expect(nextKey).toMatch(/^idem_/);
    expect(nextKey).not.toBe(firstKey);
  });

  it("sends cookie credentials and idempotency headers for console money movement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ invoice: { id: "inv_1" }, payment: { id: "pay_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.payInvoice("inv_1");

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/invoices/inv_1/pay"));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("idempotency-key")).toMatch(/^idem_/);
  });

  it("adds idempotency headers to console mutation helpers", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal("fetch", fetchMock);
    const payment = {
      type: "shielded_transfer",
      fromAccountId: "acc_operating",
      toCounterpartyId: "cp_vendor",
      amount: { amount: "10000000", assetCode: "USDC" },
    } satisfies CreatePaymentRequest;
    const actions: Array<() => Promise<unknown>> = [
      () => api.createOrg({ name: "Acme", slug: "acme" }),
      () => api.startOnboarding({ name: "Acme Inc.", country: "US" }),
      () => api.siweVerify("m", "0xsig"),
      () => api.logout(),
      () => api.provisionTreasury("org_1"),
      () => api.proveBalance("1"),
      () => api.proveTotal(),
      () => api.proveSolvency(),
      () => api.proveKyb(),
      () => api.periodTotalAttestation("2026-06"),
      () => api.fundTreasury("1"),
      () => api.treasurySendPublic("G".padEnd(56, "A"), "1"),
      () => api.updateCounterparty("cp_1", { status: "allowlisted" }),
      () => api.importRoster("name,handle,rate\\nA,@a,1"),
      () => api.createPayment(payment),
      () => api.approvePayment("po_1", { decision: "approved", actorMemberId: "mem_1" }),
      () => api.createPayroll({ period: "2026-06", source: "manual", lines: [] }),
      () => api.approvePayroll("pr_1", { decision: "approved", actorMemberId: "mem_1" }),
      () => api.proveFunded("pr_1"),
      () => api.proveApproval("pr_1"),
      () => api.proveComputation("pr_1"),
      () => api.provePolicy("pr_1", "5000"),
      () => api.createInvoice({ number: "INV-1", counterpartyId: "cp_1", lineItems: [], assetCode: "USDC", dueDate: "2026-07-01" }),
      () => api.payInvoice("inv_1"),
      () => api.netInvoices("10", "7"),
      () => api.createGrant({ auditorName: "Auditor", auditorPubKey: "0xaud", tier: "outgoing", scope: { label: "Q2", accountIds: [], from: null, to: null }, expiry: "2026-09-30T00:00:00Z" }),
      () => api.revokeGrant("vg_1"),
      () => api.updatePolicy("pol_1", { name: "Updated" }),
      () => api.anchorPrivateAuditRoot(),
      () => api.createInvite({ kind: "member", email: "member@example.com", role: "viewer" }),
      () => api.bulkInvite("name,email,role\\nA,a@example.com,viewer"),
      () => api.revokeInvite("invite_1"),
    ];

    for (const action of actions) await action();

    expect(fetchMock).toHaveBeenCalledTimes(actions.length);
    for (const call of fetchMock.mock.calls) {
      expect(callHeaders(call).get("idempotency-key")).toMatch(/^idem_/);
    }
  });

  it("keeps a mutation idempotency key after a 5xx response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "temporarily unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ invoice: { id: "inv_1" }, payment: { id: "pay_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.payInvoice("inv_1")).rejects.toThrow("temporarily unavailable");
    const firstKey = callHeaders(fetchMock.mock.calls[0]).get("idempotency-key");

    await api.payInvoice("inv_1");
    expect(callHeaders(fetchMock.mock.calls[1]).get("idempotency-key")).toBe(firstKey);
  });

  it("uses the real org and eERC onboarding endpoints", async () => {
    const complete = onboardingStatus("complete");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ org: { id: "org_1", name: "Acme", slug: "acme", role: "owner", createdAt: "2026-07-10T00:00:00.000Z" }, role: "owner" }))
      .mockResolvedValueOnce(jsonResponse({ jobId: "job_1", onboarding: onboardingStatus("pending_kyc") }, 202))
      .mockResolvedValueOnce(jsonResponse({ onboarding: complete }))
      .mockResolvedValueOnce(jsonResponse({ address: "0xtreasury", custody: "managed", registered: true, consented: true, registrationTxHash: "0xreg" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.createOrg({ name: "Acme", slug: "acme" })).resolves.toMatchObject({ role: "owner", org: { id: "org_1" } });
    await expect(api.startOnboarding({ name: "Acme Inc.", country: "US" })).resolves.toMatchObject({ jobId: "job_1" });
    await expect(api.onboardingStatus()).resolves.toMatchObject({ onboarding: { status: "complete" } });
    await expect(api.provisionTreasury("org_1")).resolves.toMatchObject({ address: "0xtreasury", custody: "managed" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      apiHref("/orgs"),
      apiHref("/onboarding/start"),
      apiHref("/onboarding/status"),
      apiHref("/orgs/org_1/treasury"),
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ name: "Acme", slug: "acme" }), credentials: "include" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ mockKyc: { name: "Acme Inc.", country: "US" } }), credentials: "include" });
    expect(callHeaders(fetchMock.mock.calls[2]).get("idempotency-key")).toBeNull();
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "POST", body: JSON.stringify({ consent: true }), credentials: "include" });
  });

  it("subscribes to onboarding status with credentialed EventSource", () => {
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      url: string | URL;
      init?: EventSourceInit;
      private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

      constructor(url: string | URL, init?: EventSourceInit) {
        this.url = url;
        this.init = init;
        FakeEventSource.instances.push(this);
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
        if (typeof listener !== "function") return;
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener as (event: MessageEvent<string>) => void);
        this.listeners.set(type, listeners);
      }

      close() {}

      emit(type: string, data: unknown) {
        const event = new MessageEvent(type, { data: JSON.stringify(data) });
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const seen: OnboardingStatus["status"][] = [];

    const subscription = api.subscribeOnboardingStatus((status) => seen.push(status.status));
    const source = FakeEventSource.instances[0];
    source.emit("status", { onboarding: onboardingStatus("kyc_approved") });
    source.emit("status", { onboarding: onboardingStatus("complete") });
    subscription.close();

    expect(source.url).toBe(apiHref("/onboarding/status/stream"));
    expect(source.init).toMatchObject({ withCredentials: true });
    expect(seen).toEqual(["kyc_approved", "complete"]);
  });

  it("loads proof receipts through the authenticated API without mutation idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: "prf_1", action: "payroll.policy.cap", vkId: "SPENDCAP", verified: true, createdAt: "2026-06-26T00:00:00.000Z" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.proofReceipts()).resolves.toHaveLength(1);

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/proof-receipts"));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("loads sanitized recovery status without mutation idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", recovery: { bound: true, status: "healthy", custody: "non-custodial", createdAt: "2026-06-26T00:00:00.000Z", lastSeenAt: "2026-06-26T00:01:00.000Z", nextSteps: ["Another owner must approve migration."] } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.recoveryStatus();
    expect(result).toMatchObject({ recovery: { bound: true } });
    expect(result.recovery.nextSteps[0]).toContain("owner");
    expect(result.recovery).not.toHaveProperty("accountFingerprint");
    expect(result.recovery).not.toHaveProperty("subjectKey");

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/recovery/status"));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("requests a SIWE nonce over the public GET endpoint", async () => {
    const address = "0x1234567890abcdef1234567890abcdef12345678";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ nonce: "abc123", expiresAt: "2026-07-10T00:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.siweNonce(address)).resolves.toMatchObject({ nonce: "abc123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(apiHref(`/auth/nonce?address=${encodeURIComponent(address)}`));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("verifies SIWE with a message and signature only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: { id: "usr_1", address: "0xabc", roles: ["owner"] } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.siweVerify("message", "0xsig")).resolves.toMatchObject({ user: { id: "usr_1" } });

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/auth/verify"));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      method: "POST",
      body: JSON.stringify({ message: "message", signature: "0xsig" }),
    });
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("idempotency-key")).toMatch(/^idem_/);
  });

  it("assembles the app session from /auth/me and /orgs", async () => {
    localStorage.setItem(ACTIVE_ORG_KEY, "org_2");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { id: "usr_1", address: "0xabc", roles: ["member"] } }))
      .mockResolvedValueOnce(jsonResponse({
        orgs: [
          { id: "org_1", name: "Acme", slug: "acme", role: "admin", createdAt: "2026-07-01T00:00:00.000Z" },
          { id: "org_2", name: "Beta", slug: "beta", role: "viewer", createdAt: "2026-07-02T00:00:00.000Z" },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const session = await api.session();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([apiHref("/auth/me"), apiHref("/orgs")]);
    expect(session).toMatchObject({
      user: { id: "usr_1", address: "0xabc" },
      activeOrg: { id: "org_2", name: "Beta", role: "viewer" },
      role: "viewer",
    });
  });

  it("falls back to the first org and supports empty org lists", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { id: "usr_1", address: "0xabc", roles: [] } }))
      .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: "org_1", name: "Acme", slug: "acme", role: "owner", createdAt: "2026-07-01T00:00:00.000Z" }] }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: "usr_1", address: "0xabc", roles: [] } }))
      .mockResolvedValueOnce(jsonResponse({ orgs: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.session()).resolves.toMatchObject({ activeOrg: { id: "org_1" }, role: "owner" });
    await expect(api.session()).resolves.toMatchObject({ activeOrg: null, role: null });
  });

  it("clears local hosted session state after authenticated 401s, but not failed SIWE verification", async () => {
    localStorage.setItem(ACTIVE_ORG_KEY, "org_1");
    localStorage.setItem("benzo.console.siweToken", "legacy.jwt");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Bad signature" }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.siweVerify("message", "0xbad")).rejects.toThrow("Bad signature");
    expect(localStorage.getItem(ACTIVE_ORG_KEY)).toBe("org_1");
    expect(localStorage.getItem("benzo.console.siweToken")).toBe("legacy.jwt");

    await expect(api.dashboard()).rejects.toThrow("Unauthorized");
    expect(localStorage.getItem(ACTIVE_ORG_KEY)).toBeNull();
    expect(localStorage.getItem("benzo.console.siweToken")).toBeNull();
  });
});
