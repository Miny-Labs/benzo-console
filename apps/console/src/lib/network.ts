import {
  BENZO_EXPLORER_BY_NETWORK,
  chainForNetwork,
  networkFromEnv,
  type BenzoNetwork,
} from "@benzo/config";

const env = import.meta.env as unknown as Record<string, string | undefined>;

/** "fuji" (default) | "benzonet" | "avalanche". */
export const NETWORK: BenzoNetwork = networkFromEnv(env.VITE_CHAIN_ENV ?? env.VITE_BENZO_NETWORK);

export const CHAIN = chainForNetwork(NETWORK);

export const CHAIN_ID = CHAIN.id;

export const EXPLORER_URL = BENZO_EXPLORER_BY_NETWORK[NETWORK];

/** Human label for the active network - never hardcode a testnet on a money screen. */
export const NETWORK_LABEL_BY_NETWORK = {
  fuji: "Avalanche Fuji",
  benzonet: "BenzoNet",
  avalanche: "Avalanche Mainnet",
} as const satisfies Record<BenzoNetwork, string>;

export const NETWORK_LABEL = NETWORK_LABEL_BY_NETWORK[NETWORK];

/**
 * Environment framing for the network chip — a financial-safety signal, not
 * wording. A testnet must NEVER read as a green "Live"; only real-money mainnet
 * gets the green (`success`) treatment. Testnet and the permissioned L1 are amber
 * (`warning`) so nobody mistakes play money for production. Consumed by the top-bar
 * NetworkMenu (chip + per-option badge) and available to any screen that surfaces
 * the active network.
 */
export type NetworkEnvKind = "testnet" | "mainnet" | "l1";

export interface NetworkEnv {
  kind: NetworkEnvKind;
  /** Short badge for pickers/pills, e.g. "Testnet". */
  badge: string;
  /** Full chip label, e.g. "Testnet · Avalanche Fuji". */
  chip: string;
  /** Design tone: mainnet = success (green); testnet / L1 = warning (amber). */
  tone: "success" | "warning";
  /** Longer one-liner for menus. */
  detail: string;
}

export const NETWORK_ENV_BY_NETWORK = {
  fuji: { kind: "testnet", badge: "Testnet", chip: "Testnet · Avalanche Fuji", tone: "warning", detail: "Avalanche C-Chain · testnet" },
  avalanche: { kind: "mainnet", badge: "Mainnet", chip: "Mainnet · Avalanche", tone: "success", detail: "Avalanche C-Chain · mainnet" },
  benzonet: { kind: "l1", badge: "Permissioned L1", chip: "Permissioned L1 · BenzoNet", tone: "warning", detail: "Permissioned Avalanche L1" },
} as const satisfies Record<BenzoNetwork, NetworkEnv>;

export const NETWORK_ENV = NETWORK_ENV_BY_NETWORK[NETWORK];

export function normalizeNetwork(value?: string): BenzoNetwork {
  return networkFromEnv(value);
}
