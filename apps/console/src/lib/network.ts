import {
  BENZO_EXPLORER_BY_NETWORK,
  chainForNetwork,
  networkFromEnv,
  type BenzoNetwork,
} from "@benzo/config";

const env = import.meta.env as unknown as Record<string, string | undefined>;

/** "fuji" (default) | "avalanche". Normalized from VITE_BENZO_NETWORK. */
export const NETWORK: BenzoNetwork = networkFromEnv(env.VITE_BENZO_NETWORK);

export const CHAIN = chainForNetwork(NETWORK);

export const CHAIN_ID = CHAIN.id;

export const EXPLORER_URL = BENZO_EXPLORER_BY_NETWORK[NETWORK];

/** Human label for the active network - never hardcode a testnet on a money screen. */
export const NETWORK_LABEL = NETWORK === "avalanche" ? "Avalanche Mainnet" : "Avalanche Fuji";

export function normalizeNetwork(value?: string): BenzoNetwork {
  return networkFromEnv(value);
}
