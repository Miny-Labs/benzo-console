/**
 * Console state: one provider that loads the session + all the read models the
 * screens render, and exposes a refresh after any write (approve, run payroll,
 * grant). Keeps the UI a thin, typed view over the BFF.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  Account,
  ApprovalPolicy,
  AuthSession,
  Counterparty,
  DashboardSummary,
  Invoice,
  LiveStatusResponse,
  Member,
  PaymentOrder,
  PayrollBatch,
  TreasuryView,
  ViewingGrant,
} from "@benzo/types";
import { api, AUTH_CHANGED_EVENT, sessionWithActiveOrg } from "./api";
import { DEMO_MODE } from "../demo/flag";

interface ConsoleState {
  session: AuthSession | null;
  liveStatus: LiveStatusResponse | null;
  dashboard: DashboardSummary | null;
  treasury: TreasuryView | null;
  payments: PaymentOrder[];
  payrolls: PayrollBatch[];
  invoices: Invoice[];
  grants: ViewingGrant[];
  counterparties: Counterparty[];
  accounts: Account[];
  members: Member[];
  policies: ApprovalPolicy[];
  loading: boolean;
  error: string | null;
  masked: boolean;
  toggleMasked: () => void;
  setActiveOrg: (id: string) => void;
  /** Reload all read models; resolves true when treasury + dashboard loaded. */
  refresh: () => Promise<boolean>;
}

const Ctx = createContext<ConsoleState | null>(null);
const DEFAULT_READ_TIMEOUT_MS = 6_000;
const CHAIN_READ_TIMEOUT_MS = 3_500;

function readModel<T>(label: string, load: () => Promise<T>, timeoutMs = DEFAULT_READ_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => {
      done = true;
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    load().then(
      (value) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatusResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
  const [payments, setPayments] = useState<PaymentOrder[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollBatch[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [grants, setGrants] = useState<ViewingGrant[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [masked, setMasked] = useState<boolean>(() => localStorage.getItem("benzo.masked") === "1");
  // Cookies are HttpOnly, so real mode boots optimistically and lets /auth/me
  // decide whether there is a live session. Demo still starts authenticated.
  const [authenticated, setAuthenticated] = useState(true);
  const booted = useRef(false);

  const clearReadModels = useCallback(() => {
    setLiveStatus(null);
    setDashboard(null);
    setTreasury(null);
    setPayments([]);
    setPayrolls([]);
    setInvoices([]);
    setGrants([]);
    setCounterparties([]);
    setAccounts([]);
    setMembers([]);
    setPolicies([]);
  }, []);

  const toggleMasked = useCallback(() => {
    setMasked((m) => {
      const next = !m;
      localStorage.setItem("benzo.masked", next ? "1" : "0");
      return next;
    });
  }, []);

  const setActiveOrg = useCallback((id: string) => {
    setSession((current) => current ? sessionWithActiveOrg(current, id) : current);
  }, []);

  const refresh = useCallback(async () => {
    let nextSession: AuthSession;
    try {
      nextSession = await readModel("session", api.session);
      setSession(nextSession);
      setAuthenticated(true);
    } catch (e) {
      if (!DEMO_MODE) {
        setAuthenticated(false);
        setSession(null);
        clearReadModels();
        setError(null);
        setLoading(false);
        return false;
      }
      setError((e as Error)?.message ?? "Failed to load");
      setLoading(false);
      return false;
    }

    if (!nextSession.activeOrg) {
      clearReadModels();
      setError(null);
      setLoading(false);
      return true;
    }

    // Load every read model independently: a single transient failure (or one
    // slow endpoint) must NOT blank every screen at once - it used to, because
    // Promise.all rejects atomically. Each slice keeps its prior value on a
    // miss; slow chain-backed slices also time out independently so grants,
    // invites, settings, and audit screens don't sit in skeleton state while
    // Chain/API reads can degrade independently. We only surface an error if the whole load fails.
    const results = await Promise.allSettled([
      readModel("live", api.live),
      readModel("dashboard", api.dashboard, CHAIN_READ_TIMEOUT_MS),
      readModel("treasury", api.treasury, CHAIN_READ_TIMEOUT_MS),
      readModel("payments", api.payments),
      readModel("payrolls", api.payrolls),
      readModel("invoices", api.invoices),
      readModel("grants", api.grants),
      readModel("counterparties", api.counterparties),
      readModel("accounts", api.accounts),
      readModel("members", api.members),
      readModel("policies", api.policies),
    ]);
    const [l, d, t, p, pr, inv, g, c, a, m, pol] = results;
    if (l.status === "fulfilled") setLiveStatus(l.value);
    if (d.status === "fulfilled") setDashboard(d.value);
    if (t.status === "fulfilled") setTreasury(t.value);
    if (p.status === "fulfilled") setPayments(p.value);
    if (pr.status === "fulfilled") setPayrolls(pr.value);
    if (inv.status === "fulfilled") setInvoices(inv.value);
    if (g.status === "fulfilled") setGrants(g.value);
    if (c.status === "fulfilled") setCounterparties(c.value);
    if (a.status === "fulfilled") setAccounts(a.value);
    if (m.status === "fulfilled") setMembers(m.value);
    if (pol.status === "fulfilled") setPolicies(pol.value);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    setError(failed.length === results.length ? (failed[0]?.reason as Error)?.message ?? "Failed to load" : null);
    setLoading(false);
    return t.status === "fulfilled" && d.status === "fulfilled"; // treasury + dashboard are critical
  }, [clearReadModels]);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    if (!authenticated) {
      setSession(null);
      clearReadModels();
      setError(null);
      setLoading(false);
      return () => {
        cancelled = true;
        if (retry) clearTimeout(retry);
      };
    }
    if (!booted.current) {
      booted.current = true;
      // First load; if the treasury/dashboard lost a race with a cold-starting
      // backend (the $0.00 bug), retry once so the dashboard isn't stuck empty.
      void refresh().then((ok) => {
        if (!ok && !cancelled) retry = setTimeout(() => void refresh(), 1500);
      });
    }
    // Keep the live read models fresh while the console is open.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) void refresh();
    }, 30_000);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      clearInterval(interval);
    };
  }, [authenticated, refresh, clearReadModels]);

  useEffect(() => {
    const onAuthChanged = () => {
      if (!DEMO_MODE) setAuthenticated(false);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  return (
    <Ctx.Provider
      value={{ session, liveStatus, dashboard, treasury, payments, payrolls, invoices, grants, counterparties, accounts, members, policies, loading, error, masked, toggleMasked, setActiveOrg, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useConsole(): ConsoleState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConsole must be used within ConsoleProvider");
  return v;
}

/** Map a counterparty id to its display name (for masked tables). */
export function useCounterpartyName() {
  const { counterparties } = useConsole();
  return (id?: string) => counterparties.find((c) => c.id === id)?.name ?? "Unknown";
}
