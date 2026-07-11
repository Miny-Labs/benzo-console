/**
 * RootGate - decides between SIWE sign-in, no-org onboarding, and the workspace.
 * Real mode trusts the cookie-backed /auth/me probe in the store; demo mode keeps
 * the old local onboarding flag so the seeded showcase still boots into the shell.
 */
import { useEffect, useState } from "react";
import { Shell } from "./Shell";
import { Onboarding } from "./Onboarding";
import { DesktopOnly, useIsDesktop } from "./DesktopOnly";
import { useConsole } from "../lib/store";
import { DEMO_MODE } from "../demo/flag";

export function RootGate() {
  const { session, loading, refresh } = useConsole();
  const isDesktop = useIsDesktop();
  // Demo mode skips SIWE onboarding entirely and boots into the Shell (the
  // desktop-only gate below still applies, this stays a desktop product).
  const [onboarded, setOnboarded] = useState(() => DEMO_MODE || localStorage.getItem("benzo.console.onboarded") === "1");
  const [orgOnboarding, setOrgOnboarding] = useState(false);
  function finish() {
    localStorage.setItem("benzo.console.onboarded", "1");
    setOnboarded(true);
    void refresh();
  }
  function finishOrgOnboarding() {
    setOrgOnboarding(false);
    void refresh();
  }
  useEffect(() => {
    if (!session) {
      setOrgOnboarding(false);
      return;
    }
    if (!session.activeOrg) setOrgOnboarding(true);
  }, [session]);
  if (!isDesktop) return <DesktopOnly />;
  if (DEMO_MODE) return onboarded ? <Shell /> : <Onboarding onDone={finish} />;
  if (loading && !session) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--color-canvas-outer)] text-sm font-medium text-muted">
        Loading workspace…
      </div>
    );
  }
  if (session && (orgOnboarding || !session.activeOrg)) return <Onboarding onDone={finishOrgOnboarding} />;
  return session?.activeOrg ? <Shell /> : <Onboarding onDone={() => void refresh()} />;
}
