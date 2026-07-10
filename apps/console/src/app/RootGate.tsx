/**
 * RootGate - decides between the onboarding flow and the workspace. Gated by a
 * client flag (`benzo.console.onboarded`) so it's isolated per browser session
 * (no shared-BFF state to pollute), exactly like the consumer wallet's first-run.
 * Onboarding finish applies the draft to the org server-side, sets the flag, and
 * refreshes the store so the Shell boots into the live workspace.
 */
import { useState } from "react";
import { Shell } from "./Shell";
import { Onboarding } from "./Onboarding";
import { DesktopOnly, useIsDesktop } from "./DesktopOnly";
import { useConsole } from "../lib/store";
import { DEMO_MODE } from "../demo/flag";

export function RootGate() {
  const { refresh } = useConsole();
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
  return onboarded ? <Shell /> : <Onboarding onDone={finish} />;
}
