/**
 * RootGate - decides between SIWE sign-in and the workspace. Real mode trusts the
 * cookie-backed /auth/me probe in the store; demo mode keeps the old local
 * onboarding flag so the seeded showcase still boots straight into the shell.
 */
import { useState } from "react";
import { Shell } from "./Shell";
import { Onboarding } from "./Onboarding";
import { DesktopOnly, useIsDesktop } from "./DesktopOnly";
import { useConsole } from "../lib/store";
import { DEMO_MODE } from "../demo/flag";

export function RootGate() {
  const { session, loading, refresh } = useConsole();
  const isDesktop = useIsDesktop();
  // Demo mode skips SIWE onboarding entirely and boots into the Shell (the
  // desktop-only gate below still applies — this stays a desktop product).
  const [onboarded, setOnboarded] = useState(() => DEMO_MODE || localStorage.getItem("benzo.console.onboarded") === "1");
  function finish() {
    localStorage.setItem("benzo.console.onboarded", "1");
    setOnboarded(true);
    void refresh();
  }
  if (!isDesktop) return <DesktopOnly />;
  if (DEMO_MODE) return onboarded ? <Shell /> : <Onboarding onDone={finish} />;
  if (loading && !session) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--color-canvas-outer)] text-sm font-medium text-muted">
        Loading workspace…
      </div>
    );
  }
  return session ? <Shell /> : <Onboarding onDone={() => void refresh()} />;
}
