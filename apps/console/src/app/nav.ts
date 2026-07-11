/**
 * Nav model — the single source of truth for the sidebar + command bar, and which
 * screens are exposed in each build mode. In **real mode** the console only shows
 * screens that actually talk to the eERC backend (auth/onboarding/treasury/payroll);
 * the rest (Overview, Contractors, Invoices, one-off Pay, Approvals, Grants, Audit,
 * Settings) have no backend on this platform and stay **demo-only**. Demo mode
 * (`VITE_DEMO_MODE=1`) shows the full product as the vision.
 */
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, CheckCheck, FileText, LayoutDashboard, ScrollText, Settings, ShieldCheck, Users, Wallet } from "lucide-react";
import { DEMO_MODE } from "../demo/flag";

export type NavGroup = "Overview" | "Payments" | "Operations" | "Compliance" | "Settings";

export interface NavItemDef {
  to: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  /** True only when the screen is wired to a real backend endpoint. */
  realBacked: boolean;
  /** Pinned to the bottom of the sidebar (Settings). */
  footer?: boolean;
}

export const NAV_ITEMS: NavItemDef[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, group: "Overview", realBacked: false },
  { to: "/contractors", label: "Contractors", icon: Users, group: "Payments", realBacked: false },
  { to: "/payroll", label: "Payroll", icon: Users, group: "Payments", realBacked: true },
  { to: "/invoices", label: "Invoices", icon: FileText, group: "Payments", realBacked: false },
  { to: "/pay", label: "One-off payment", icon: ArrowUpRight, group: "Payments", realBacked: false },
  { to: "/approvals", label: "Approvals", icon: CheckCheck, group: "Operations", realBacked: false },
  { to: "/treasury", label: "Treasury", icon: Wallet, group: "Operations", realBacked: true },
  { to: "/grants", label: "Auditor access", icon: ShieldCheck, group: "Compliance", realBacked: false },
  { to: "/audit", label: "Audit log", icon: ScrollText, group: "Compliance", realBacked: false },
  { to: "/settings", label: "Settings & team", icon: Settings, group: "Settings", realBacked: false, footer: true },
];

/** Where real mode lands (Overview has no backend). */
export const REAL_HOME = "/treasury";

/** Nav items to render for the given build mode. Real mode hides no-backend screens. */
export function visibleNavItems(demoMode: boolean = DEMO_MODE): NavItemDef[] {
  return NAV_ITEMS.filter((item) => demoMode || item.realBacked);
}

/** Ordered, de-duplicated list of groups that have at least one visible non-footer item. */
export function visibleNavGroups(demoMode: boolean = DEMO_MODE): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of visibleNavItems(demoMode)) {
    if (item.footer) continue;
    if (!groups.includes(item.group)) groups.push(item.group);
  }
  return groups;
}
