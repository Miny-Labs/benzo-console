import type { ReactNode } from "react";

/**
 * A label/value row styled for the dark SendCeremony surface. Shared by every
 * flow that feeds `details` into the ceremony so spacing/a11y stay in lockstep.
 */
export function CeremonyRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex-none text-white/48">{k}</span>
      <span className="min-w-0 truncate text-right font-semibold text-white">{v}</span>
    </div>
  );
}
