import type { Address, Chain } from "viem";
import { avalanche, avalancheFuji } from "viem/chains";

export type BenzoNetwork = "fuji" | "avalanche";

export const BENZO_NETWORKS = {
  fuji: "fuji",
  avalanche: "avalanche",
} as const satisfies Record<BenzoNetwork, BenzoNetwork>;

export const BENZO_CHAIN_BY_NETWORK = {
  fuji: avalancheFuji,
  avalanche,
} as const satisfies Record<BenzoNetwork, Chain>;

export const BENZO_CHAINS = [
  BENZO_CHAIN_BY_NETWORK.fuji,
  BENZO_CHAIN_BY_NETWORK.avalanche,
] as const;

export const BENZO_EXPLORER_BY_NETWORK = {
  fuji: "https://testnet.snowtrace.io",
  avalanche: "https://snowtrace.io",
} as const satisfies Record<BenzoNetwork, string>;

export interface BenzoContractAddresses {
  eerc: Address;
  registrar: Address;
  payroll: Address;
  auditor: Address;
  networkAdmin: Address;
  usdc: Address;
}

const TODO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

// TODO(@benzo/config): replace this vendored map with the published benzo config
// package once services/api and the deployed eERC contracts expose canonical
// addresses for each Avalanche network.
export const BENZO_ADDRESSES_BY_CHAIN_ID: Record<number, BenzoContractAddresses> = {
  [avalancheFuji.id]: {
    eerc: TODO_ADDRESS,
    registrar: TODO_ADDRESS,
    payroll: TODO_ADDRESS,
    auditor: TODO_ADDRESS,
    networkAdmin: TODO_ADDRESS,
    usdc: TODO_ADDRESS,
  },
  [avalanche.id]: {
    eerc: TODO_ADDRESS,
    registrar: TODO_ADDRESS,
    payroll: TODO_ADDRESS,
    auditor: TODO_ADDRESS,
    networkAdmin: TODO_ADDRESS,
    usdc: TODO_ADDRESS,
  },
};

export function networkFromEnv(value: string | undefined): BenzoNetwork {
  if (value === "avalanche" || value === "mainnet" || value === "public") return "avalanche";
  return "fuji";
}

export function chainForNetwork(network: BenzoNetwork): Chain {
  return BENZO_CHAIN_BY_NETWORK[network];
}

export function addressesForChain(chainId: number): BenzoContractAddresses {
  return BENZO_ADDRESSES_BY_CHAIN_ID[chainId] ?? BENZO_ADDRESSES_BY_CHAIN_ID[avalancheFuji.id];
}
