/**
 * Display formatting for money, addresses, dates, and explorer links.
 * Amounts are USDC base units (6 decimals on Avalanche) as string|bigint.
 */
import { BENZO_EXPLORER_BY_NETWORK } from "@benzo/config";
import { NETWORK, normalizeNetwork } from "./network";

export const USDC_DECIMALS = 6;
export const USDC_SCALE = 10 ** USDC_DECIMALS;

/** "1234567000" (6dp) -> "1,234.567" (trailing zeros trimmed, min 2 decimals). */
export function formatMoney(minor: string | bigint, decimals = USDC_DECIMALS, code = "USDC"): string {
  let n: bigint;
  try { n = typeof minor === "bigint" ? minor : BigInt(minor || "0"); } catch { return String(minor); }
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}${code ? ` ${code}` : ""}`;
}

/** "$842,300.00" - dollar-prefixed, fixed 2 decimals (the dashboard headline form). */
export function fmtUsd(minor: string | bigint, decimals = USDC_DECIMALS): string {
  let n: bigint;
  try {
    n = typeof minor === "bigint" ? minor : BigInt(minor || "0");
  } catch {
    return String(minor);
  }
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % base).toString().padStart(decimals, "0").slice(0, 2);
  return `${neg ? "-" : ""}$${whole}.${cents}`;
}

export function usdcToMinor(human: string, decimals = USDC_DECIMALS): string {
  const [whole = "0", frac = ""] = human.replace(/[$,]/g, "").trim().split(".");
  return (BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0").slice(0, decimals) || "0")).toString();
}

export function minorToUsdc(minor: string | string[], decimals = USDC_DECIMALS): string {
  if (Array.isArray(minor)) return "";
  const raw = BigInt(minor || "0");
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** "0x1234…abcd" - truncate an EVM address / hash for display. */
export function formatAddress(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function toDate(ts: number | string | Date): Date | null {
  const d = ts instanceof Date ? ts : new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Date-only display: "22 Jul 2026", NO time component. Formatted from the value's
 * UTC calendar day so a date-only value (a due date / expiry stored as midnight UTC)
 * can never leak a spurious local time (the "05:30" IST artifact) or shift a day
 * across timezones. Use this for due dates, expiries, period labels, anything that
 * is conceptually a day, not an instant.
 */
export function fmtDate(ts: number | string | Date): string {
  const d = toDate(ts);
  if (!d) return String(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Full timestamp display (local): date + time, for genuine instants (posted-at,
 * settled-at). Use this ONLY when the time actually matters, otherwise use fmtDate.
 */
export function fmtDateTime(ts: number | string | Date): string {
  const d = toDate(ts);
  if (!d) return String(ts);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** @deprecated Prefer {@link fmtDate} for days and {@link fmtDateTime} for instants. Kept for back-compat (identical to fmtDateTime). */
export function formatDate(ts: number | string | Date): string {
  return fmtDateTime(ts);
}

/**
 * Person initials for avatars, the ONE shared source so the top-bar avatar and the
 * Settings/team rows never disagree (the "JE vs JO" bug). Two words → first letter of
 * first + last ("John Everett" → "JE"); one word / an email → first two chars
 * ("jordan@acme.co" → "JO"). Always uppercase.
 */
export function initials(name?: string | null, fallback = ""): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Default to the build's active network (NETWORK), never a hardcoded testnet:
// these links are the real settlement receipts, so on a mainnet build they
// must deep-link to the right explorer (a testnet default => "tx not found" => the
// payment looks unverified). A caller can still pass an explicit network when it has one
// (e.g. the on-chain ref's own network field).
export function explorerTxUrl(hash: string, network: string = NETWORK): string {
  return `${BENZO_EXPLORER_BY_NETWORK[normalizeNetwork(network)]}/tx/${hash}`;
}

export function explorerContractUrl(id: string, network: string = NETWORK): string {
  return `${BENZO_EXPLORER_BY_NETWORK[normalizeNetwork(network)]}/address/${id}`;
}

/**
 * Turn a thrown error into operator-facing copy. Surfaces the useful operational
 * messages (handle/balance/approval/amount/funding/network) verbatim; genericizes
 * anything that reads technical (stack traces, JSON-RPC noise, fetch failures), and
 * logs the raw error for debugging. Mirrors the friendly pattern already in Pay.tsx.
 */
export function friendlyError(e: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return fallback;
  if (/network|offline|fetch|timeout|connection|failed to fetch/i.test(raw)) {
    return "Network problem. Check your connection and try again.";
  }
  // operationally useful, human-readable errors pass through
  if (/handle|balance|approv|amount|fund|cap|threshold|quorum|expired|permission|not found|invalid/i.test(raw)) {
    return raw;
  }
  // looks like a raw technical message (stack/JSON/long token) → genericize
  if (raw.length > 140 || /[{}<>]|0x[0-9a-f]{6,}|\bat\s+\w+\.|Error:/i.test(raw)) {
    return fallback;
  }
  return raw;
}
