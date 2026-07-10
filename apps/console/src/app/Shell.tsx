/**
 * Console shell - 240px sidebar (grouped nav with an Approvals badge), a top bar
 * (workspace switcher, ⌘K search, live network badge, mask-eye, bell, avatar),
 * and the routed content area with the cursor-interactive canvas behind the cards.
 */
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  CheckCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { StageVideo } from "../ui/StageVideo";
import { CommandBar } from "./CommandBar";
import { AvalancheMark, Logo } from "../ui/Logo";
import { NetworkMenu } from "./NetworkMenu";
import { useConsole } from "../lib/store";
import { initials } from "../lib/format";
import { Dashboard } from "../screens/Dashboard";
import { Approvals } from "../screens/Approvals";
import { Contractors } from "../screens/Contractors";
import { Invoices } from "../screens/Invoices";
import { Payroll } from "../screens/Payroll";
import { Pay } from "../screens/Pay";
import { Treasury } from "../screens/Treasury";
import { Grants } from "../screens/Grants";
import { AuditLog } from "../screens/AuditLog";
import { InviteClaim } from "../screens/InviteClaim";
import { SettingsScreen } from "../screens/Settings";

function NavItem({ to, icon: Icon, label, badge }: { to: string; icon: typeof Users; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `group flex min-h-[40px] items-center gap-3 rounded-[9px] px-2.5 py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 ${
          isActive ? "bg-primary/[0.07] text-primary" : "text-[#3a4452] hover:bg-[#f4f3ef]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={20} className={isActive ? "text-primary" : "text-[#8a9099]"} />
          {label}
          {badge ? <span className="ml-auto rounded-full bg-primary px-1.5 py-px text-[11px] font-bold text-white">{badge}</span> : null}
        </>
      )}
    </NavLink>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pb-1 pt-3.5 text-[11px] font-bold uppercase tracking-[0.07em] text-[#a3a7ac]">{children}</div>;
}

export function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const { session, liveStatus, dashboard, payments, masked, toggleMasked } = useConsole();
  const pending = dashboard?.pendingApprovals ?? payments.filter((p) => p.status === "needs_approval").length;
  const live = liveStatus?.live ?? dashboard?.live ?? false;
  // Top-bar popovers (workspace switcher + notifications).
  const [menu, setMenu] = useState<null | "workspace" | "bell">(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);
  // Close any open popover on route change.
  useEffect(() => setMenu(null), [loc.pathname]);
  // Shared initials helper so the top-bar avatar and Settings/team never disagree.
  const avatarInitials = initials(session?.member.name, "JD");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-canvas-outer)] p-0 sm:p-6">
      {/* looping video stage BEHIND the workspace card (not inside the content) */}
      <StageVideo />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-none border border-border bg-bg shadow-[0_30px_80px_rgba(25,40,55,0.18)] sm:rounded-2xl">
        {/* full-width top bar: brand cell (above the sidebar) + controls (above content) */}
        <header className="flex h-[60px] flex-none items-center border-b border-border bg-surface">
          <div className="font-display flex h-full w-[240px] flex-none items-center gap-2.5 border-r border-border px-5 text-lg">
            <Logo size={24} className="text-ink" /> Benzo
          </div>
          <div ref={barRef} className="flex flex-1 items-center gap-3.5 px-5">
            <div className="relative flex-none">
              <button
                onClick={() => setMenu((m) => (m === "workspace" ? null : "workspace"))}
                aria-haspopup="menu"
                aria-expanded={menu === "workspace"}
                data-testid="workspace-switcher"
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm font-semibold outline-none transition hover:bg-[#f4f3ef] focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[#e7e0fb] text-[12px] font-bold text-[#4a2fa0]">
                  {(session?.org.name ?? "A")[0]}
                </span>
                <span className="max-w-[160px] truncate">{session?.org.name ?? "Workspace"}</span>
                <ChevronDown size={15} className={`text-[#a3a7ac] transition ${menu === "workspace" ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {menu === "workspace" ? (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                    className="absolute left-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_50px_rgba(25,40,55,0.16)]"
                    data-testid="workspace-menu"
                  >
                    <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-[#e7e0fb] text-[13px] font-bold text-[#4a2fa0]">
                        {(session?.org.name ?? "A")[0]}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-ink">{session?.org.name ?? "Workspace"}</div>
                        <div className="truncate text-[12px] text-muted">{session?.member.name ?? "Signed in"}</div>
                      </div>
                    </div>
                    <button role="menuitem" onClick={() => { setMenu(null); nav("/settings"); }} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-[#3a4452] outline-none transition hover:bg-[#f4f3ef] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                      <Settings size={15} className="text-[#8a9099]" /> Settings &amp; team
                    </button>
                    <div className="border-t border-border px-3.5 py-2.5 text-[11.5px] text-muted">
                      Adding more workspaces is coming soon.
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
            <CommandBar />
            <NetworkMenu live={live} />
            <button onClick={toggleMasked} aria-label="Toggle amount masking" data-testid="mask-toggle" className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-border text-[#6b6f74] outline-none transition hover:bg-[#f4f3ef] focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95">
              {masked ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
            <div className="relative flex-none">
              <button
                onClick={() => setMenu((m) => (m === "bell" ? null : "bell"))}
                aria-label={pending ? `Notifications — ${pending} awaiting approval` : "Notifications"}
                title={pending ? `${pending} awaiting approval` : "Notifications"}
                aria-haspopup="menu"
                aria-expanded={menu === "bell"}
                data-testid="notifications"
                className="relative flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-border text-[#6b6f74] outline-none transition hover:bg-[#f4f3ef] focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95"
              >
                <Bell size={17} />
                {pending ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> : null}
              </button>
              <AnimatePresence>
                {menu === "bell" ? (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_50px_rgba(25,40,55,0.16)]"
                    data-testid="notifications-panel"
                  >
                    <div className="border-b border-border px-3.5 py-3 text-[13px] font-semibold text-ink">Notifications</div>
                    {pending ? (
                      <button onClick={() => { setMenu(null); nav("/approvals"); }} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left outline-none transition hover:bg-[#f4f3ef] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary/10 text-primary"><CheckCheck size={15} /></span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-ink">{pending} payment{pending === 1 ? "" : "s"} awaiting approval</span>
                          <span className="block text-[12px] text-muted">Open Approvals to review and release.</span>
                        </span>
                      </button>
                    ) : (
                      <div className="px-3.5 py-6 text-center text-[12.5px] text-muted">You're all caught up.</div>
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{avatarInitials}</div>
          </div>
        </header>

        {/* body: sidebar nav + routed content */}
        <div className="flex flex-1 overflow-hidden">
          <aside className="flex w-[240px] flex-none flex-col gap-1 border-r border-border bg-surface px-3.5 py-4">
            <Eyebrow>Overview</Eyebrow>
            <NavItem to="/" icon={LayoutDashboard} label="Overview" />
            <Eyebrow>Payments</Eyebrow>
            <NavItem to="/contractors" icon={Users} label="Contractors" />
            <NavItem to="/payroll" icon={Users} label="Payroll" />
            <NavItem to="/invoices" icon={FileText} label="Invoices" />
            <NavItem to="/pay" icon={ArrowUpRight} label="One-off payment" />
            <Eyebrow>Operations</Eyebrow>
            <NavItem to="/approvals" icon={CheckCheck} label="Approvals" badge={pending || undefined} />
            <NavItem to="/treasury" icon={Wallet} label="Treasury" />
            <Eyebrow>Compliance</Eyebrow>
            <NavItem to="/grants" icon={ShieldCheck} label="Auditor access" />
            <NavItem to="/audit" icon={ScrollText} label="Audit log" />
            <div className="flex-1" />
            <NavItem to="/settings" icon={Settings} label="Settings & team" />
            <div className="mt-auto flex items-center justify-center gap-1.5 border-t border-border/60 pt-3 text-[11px] font-medium text-[#8a9099]" data-testid="built-on-avalanche">
              <AvalancheMark size={13} /> Built on Avalanche
            </div>
          </aside>

          <div className="relative flex flex-1 flex-col overflow-hidden">
            <main className="no-scrollbar relative z-10 h-full overflow-y-auto px-5 py-6">
              <Routes location={loc} key={loc.pathname}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/contractors" element={<Contractors />} />
                <Route path="/payroll" element={<Payroll />} />
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/pay" element={<Pay />} />
                <Route path="/treasury" element={<Treasury />} />
                <Route path="/grants" element={<Grants />} />
                <Route path="/audit" element={<AuditLog />} />
                <Route path="/claim" element={<InviteClaim />} />
                <Route path="/settings" element={<SettingsScreen />} />
                <Route path="*" element={<Dashboard />} />
              </Routes>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
