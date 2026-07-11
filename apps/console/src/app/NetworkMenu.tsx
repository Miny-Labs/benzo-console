/**
 * Top-bar network indicator + chain info, **read-only, not a switcher**. Benzo
 * Console runs on a single chain (the permissioned BenzoNet L1 by default; pinned at
 * build time), so this shows the active network's identity, environment, and details
 * (chain id / RPC / explorer). There is no network selection: the console isn't
 * multi-chain, and a "switcher" that couldn't actually re-point the app would be a lie.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { BENZO_EXPLORER_BY_NETWORK, chainForNetwork, type BenzoNetwork } from "@benzo/config";
import { NETWORK, NETWORK_ENV_BY_NETWORK, NETWORK_LABEL_BY_NETWORK, type NetworkEnv } from "../lib/network";
import { AvalancheMark, Logo } from "../ui/Logo";

/** Amber (testnet / permissioned L1) vs green (real-money mainnet) chrome. */
function envToneCls(env: NetworkEnv): string {
  return env.tone === "success"
    ? "border-success/25 bg-success/10 text-[#1d7a52]"
    : "border-warning/30 bg-warning/12 text-[#9a6b12]";
}

/** Explicit environment badge, Testnet / Mainnet / Permissioned L1. */
function EnvBadge({ env }: { env: NetworkEnv }) {
  return (
    <span className={`flex-none rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${envToneCls(env)}`}>
      {env.badge}
    </span>
  );
}

function chainInfo(n: BenzoNetwork) {
  const c = chainForNetwork(n);
  return {
    label: NETWORK_LABEL_BY_NETWORK[n],
    id: c.id,
    rpc: c.rpcUrls.default.http[0] ?? "",
    explorer: BENZO_EXPLORER_BY_NETWORK[n],
    kind: n === "benzonet" ? "Permissioned Avalanche L1" : n === "avalanche" ? "Avalanche C-Chain · mainnet" : "Avalanche C-Chain · testnet",
  };
}

/** Per-network brand badge: Avalanche for Fuji + mainnet, the Benzo mark for BenzoNet. */
function Mark({ network, size }: { network: BenzoNetwork; size: number }) {
  if (network === "benzonet") {
    return (
      <span className="inline-flex flex-none items-center justify-center rounded-full bg-primary text-white" style={{ width: size, height: size }}>
        <Logo size={Math.round(size * 0.56)} />
      </span>
    );
  }
  return <AvalancheMark size={size} className="flex-none" />;
}

export function NetworkMenu({ live }: { live: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Everything is keyed to the single build-time NETWORK, there is no selection.
  const info = chainInfo(NETWORK);
  const env = NETWORK_ENV_BY_NETWORK[NETWORK];
  // Chrome by ENVIRONMENT (never by liveness): amber for testnet / permissioned L1,
  // green only for real-money mainnet. Liveness is a separate axis, a subtle heartbeat
  // when connected, a red "Offline · …" when the chain is unreachable.
  const chipTone = live ? envToneCls(env) : "border-danger/30 bg-danger/10 text-[#b4232a]";
  const chipLabel = live ? env.chip : `Offline · ${env.badge}`;

  return (
    <div className="relative flex-none" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="network-menu-trigger"
        title={live ? `Connected · ${env.detail}` : "Chain unavailable"}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 ${chipTone}`}
      >
        <Mark network={NETWORK} size={16} />
        <span className="truncate">{chipLabel}</span>
        {live ? <span className={`h-1.5 w-1.5 flex-none rounded-full ${env.tone === "success" ? "bg-success" : "bg-warning"} animate-pulse`} /> : null}
        <ChevronDown size={13} className={`opacity-60 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            data-testid="network-menu"
            className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right rounded-2xl border border-border bg-surface p-3 shadow-[0_16px_40px_rgba(25,40,55,0.14)]"
          >
            <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#a3a7ac]">Network</div>
            <div className="flex items-center gap-2.5 rounded-xl bg-primary/[0.06] px-2.5 py-2">
              <Mark network={NETWORK} size={24} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-fg">{info.label}</span>
                  <EnvBadge env={env} />
                </div>
                <div className="truncate text-[11px] text-muted">{info.kind}</div>
              </div>
            </div>
            <div className="mt-3 space-y-0.5 rounded-xl border border-border bg-bg p-2.5 text-[11.5px]" data-testid="network-chain-info">
              <InfoRow k="Chain ID" v={String(info.id)} />
              <InfoRow k="RPC" v={info.rpc.replace(/^https?:\/\//, "")} title={info.rpc} truncate />
              <InfoRow k="Explorer" v={info.explorer.replace(/^https?:\/\//, "")} href={info.explorer} truncate />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function InfoRow({ k, v, href, truncate, title }: { k: string; v: string; href?: string; truncate?: boolean; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex-none text-muted">{k}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={title ?? v} className={`min-w-0 rounded font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40 ${truncate ? "truncate" : ""}`}>
          {v}
        </a>
      ) : (
        <span title={title ?? v} className={`min-w-0 font-medium text-fg ${truncate ? "truncate" : ""}`}>
          {v}
        </span>
      )}
    </div>
  );
}
