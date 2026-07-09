import { defineChain, type Address, type Chain } from "viem";
import { avalanche, avalancheFuji } from "viem/chains";

export { avalanche };

export const FUJI_CHAIN_ID = 43_113;
export const BENZONET_CHAIN_ID = 68_420;
export const AVALANCHE_CHAIN_ID = 43_114;
export const BENZONET_BLOCKCHAIN_ID =
  "21iisL1nkpM2AauUadAz7p1gK3waRBZLEJme3LU3gsWpaxy792";
export const BENZONET_RPC_URL = "https://rpc.benzo.space";
export const BENZONET_RPC_PATH = `/ext/bc/${BENZONET_BLOCKCHAIN_ID}/rpc`;
export const BENZONET_LOCAL_RPC_URL = `http://127.0.0.1:9650${BENZONET_RPC_PATH}`;

export const benzonet = defineChain({
  id: BENZONET_CHAIN_ID,
  name: "BenzoNet",
  nativeCurrency: {
    decimals: 18,
    name: "Benzo Gas",
    symbol: "BGAS",
  },
  rpcUrls: {
    default: {
      http: [BENZONET_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "BenzoNet Explorer",
      url: "https://explorer.benzo.space",
    },
  },
  testnet: true,
});

export const fuji = avalancheFuji;

export type BenzoNetwork = "fuji" | "benzonet" | "avalanche";

export const BENZO_NETWORKS = {
  fuji: "fuji",
  benzonet: "benzonet",
  avalanche: "avalanche",
} as const satisfies Record<BenzoNetwork, BenzoNetwork>;

export const BENZO_CHAIN_BY_NETWORK = {
  fuji: avalancheFuji,
  benzonet,
  avalanche,
} as const satisfies Record<BenzoNetwork, Chain>;

export const BENZO_CHAINS = [
  BENZO_CHAIN_BY_NETWORK.fuji,
  BENZO_CHAIN_BY_NETWORK.benzonet,
  BENZO_CHAIN_BY_NETWORK.avalanche,
] as const;

export const benzoChains = BENZO_CHAINS;

export const BENZO_EXPLORER_BY_NETWORK = {
  fuji: "https://testnet.snowtrace.io",
  benzonet: "https://explorer.benzo.space",
  avalanche: "https://snowtrace.io",
} as const satisfies Record<BenzoNetwork, string>;

export const DEPLOYMENT_NETWORKS = ["fuji", "benzonet", "avalanche"] as const;

export type DeploymentNetwork = (typeof DEPLOYMENT_NETWORKS)[number];
export type DeploymentChainId =
  | typeof FUJI_CHAIN_ID
  | typeof BENZONET_CHAIN_ID
  | typeof AVALANCHE_CHAIN_ID;
export type CircuitOperation = "registration" | "transfer" | "mint" | "withdraw" | "burn";
export type VerifierDeployments = Record<CircuitOperation, Address>;

export interface BenzoToken {
  address: Address;
  decimals: number;
  tokenId: number;
  symbol: string;
}

export interface BenzoCctpConfig {
  domain: number;
  tokenMessenger: Address;
  messageTransmitter: Address;
  autoDepositRouter: Address | null;
}

export interface DeploymentContracts {
  verifiers: VerifierDeployments;
  Registrar: Address;
  EncryptedERC: Address;
  BabyJubJub: Address;
  tokens: Record<string, BenzoToken>;
  tUSDC?: Address;
  HandleRegistry?: Address;
  PrivateGiftEscrow?: Address;
  cctp: BenzoCctpConfig | null;
  benzoCctpRouter?: Address;
  auditor: Address;
}

export interface BenzoContractAddresses extends DeploymentContracts {
  /** Backward-compatible alias for `EncryptedERC`. */
  eerc: Address;
  /** Backward-compatible alias for `Registrar`. */
  registrar: Address;
  babyJubJub: Address;
  usdc?: Address;
  eurc?: Address;
  privateGiftEscrow?: Address;
}

export interface Deployments {
  network: DeploymentNetwork;
  chainId: DeploymentChainId;
  contracts: BenzoContractAddresses;
}

export const fujiDeployments = {
  network: "fuji",
  chainId: FUJI_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x4250bD1eb89Ef78469f94da2fE7738DCdcb09Ef7",
      transfer: "0x4bF3DBD3fF57943dC402ec1F280589E1032A32A5",
      mint: "0x0fE395F5E97Ee02c961DE3d035E5De2D9019D15E",
      withdraw: "0x7E194cb8A575d23f74EEDbEf1b519B281B29c30e",
      burn: "0x1BDfD6cB772D5F882622BaFD7B19898Da9F61d34",
    },
    Registrar: "0x9a63FEa9851097DBAf3757b636217fdde50ABaF0",
    EncryptedERC: "0x9E16eD3B799541B4929f7E2014904C65E81035b1",
    BabyJubJub: "0x04513c37Fca1FBABA5Bb6Ff9547658b00B35697B",
    tokens: {
      USDC: {
        address: "0x5425890298aed601595a70AB815c96711a31Bc65",
        decimals: 6,
        tokenId: 1,
        symbol: "USDC",
      },
      EURC: {
        address: "0x5E44db7996c682E92a960b65AC713a54AD815c6B",
        decimals: 6,
        tokenId: 2,
        symbol: "EURC",
      },
    },
    HandleRegistry: "0xC74EcCDE4D9A1F48D560de9A96521D28D58B474b",
    PrivateGiftEscrow: "0x0B1f4e78C54E7696663b62F9cD7956f5FDE5b71d",
    cctp: {
      domain: 1,
      tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
      messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
      autoDepositRouter: "0x4b4f0dc760115DB356Cdfa89b4950E3418a3d98d",
    },
    benzoCctpRouter: "0x4b4f0dc760115DB356Cdfa89b4950E3418a3d98d",
    auditor: "0x13b8d12414dd468a9eCbA24d0a162C17affd6D32",
    eerc: "0x9E16eD3B799541B4929f7E2014904C65E81035b1",
    registrar: "0x9a63FEa9851097DBAf3757b636217fdde50ABaF0",
    babyJubJub: "0x04513c37Fca1FBABA5Bb6Ff9547658b00B35697B",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    eurc: "0x5E44db7996c682E92a960b65AC713a54AD815c6B",
    privateGiftEscrow: "0x0B1f4e78C54E7696663b62F9cD7956f5FDE5b71d",
  },
} as const satisfies Deployments;

export const benzonetDeployments = {
  network: "benzonet",
  chainId: BENZONET_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x4c9CF63e688D08c633bEB4CcB1cfAbc73DA0Ea88",
      transfer: "0x1F6C733F5d4B5fe828BA7bCDf1d7657cD9fcE8c4",
      mint: "0xE0A5d3d93D28551546c7D7584dfA6C63C6A01e85",
      withdraw: "0x052100fC561F699fC56e57C1FD4A7468FbB78267",
      burn: "0xfFB661949498C9A028dF80021eD57D3eF535B025",
    },
    Registrar: "0x0B1f4e78C54E7696663b62F9cD7956f5FDE5b71d",
    EncryptedERC: "0xEE46418e5EeFE6f74EFaa9beb370B59251BFFb02",
    BabyJubJub: "0xbADeF08FE085928c36cF1301CfAa4d8061DA2469",
    tokens: {
      tUSDC: {
        address: "0x25B6a6bcF1aea52CE27A302E521aF9dBDD27D2E7",
        decimals: 6,
        tokenId: 1,
        symbol: "tUSDC",
      },
    },
    tUSDC: "0x25B6a6bcF1aea52CE27A302E521aF9dBDD27D2E7",
    cctp: null,
    auditor: "0x13b8d12414dd468a9eCbA24d0a162C17affd6D32",
    eerc: "0xEE46418e5EeFE6f74EFaa9beb370B59251BFFb02",
    registrar: "0x0B1f4e78C54E7696663b62F9cD7956f5FDE5b71d",
    babyJubJub: "0xbADeF08FE085928c36cF1301CfAa4d8061DA2469",
  },
} as const satisfies Deployments;

export const avalancheDeployments = {
  network: "avalanche",
  chainId: AVALANCHE_CHAIN_ID,
  contracts: {
    verifiers: {
      registration: "0x35b4C4227082f67c01656A39aC47F6c5D6005CaA",
      transfer: "0x4A716026a0C1F7158165520B6DF2009fFeB79f01",
      mint: "0xb0ea11Bf58ad83F1027E476cbA7B8E196Cc0C972",
      withdraw: "0xDf3caC632d70365cEb5CD1DD72E5de741936fdb7",
      burn: "0xCb59d38DA7F1E4cA11BfFa6BEd383624fa49bc3d",
    },
    Registrar: "0x902B8D5585A5124C9B9c001A95b7f520C07a79F2",
    EncryptedERC: "0x708d0b83461973F46041a36f588b8760dbC0Db0e",
    BabyJubJub: "0x91eb19da5A7486b4AAb4a0e452299B7E6F3821F4",
    tokens: {
      USDC: {
        address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
        decimals: 6,
        tokenId: 1,
        symbol: "USDC",
      },
      EURC: {
        address: "0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD",
        decimals: 6,
        tokenId: 2,
        symbol: "EURC",
      },
    },
    PrivateGiftEscrow: "0xb22c366e000165683A51C2630F6Ab818e5227C94",
    cctp: {
      domain: 1,
      tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
      autoDepositRouter: "0x83F26C562082e3c455938fd48162e990494a4caE",
    },
    benzoCctpRouter: "0x83F26C562082e3c455938fd48162e990494a4caE",
    auditor: "0x5ba6F05b245C06c3a4C05e7bC4486dE3661393ea",
    eerc: "0x708d0b83461973F46041a36f588b8760dbC0Db0e",
    registrar: "0x902B8D5585A5124C9B9c001A95b7f520C07a79F2",
    babyJubJub: "0x91eb19da5A7486b4AAb4a0e452299B7E6F3821F4",
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    eurc: "0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD",
    privateGiftEscrow: "0xb22c366e000165683A51C2630F6Ab818e5227C94",
  },
} as const satisfies Deployments;

export const deploymentsByNetwork = {
  fuji: fujiDeployments,
  benzonet: benzonetDeployments,
  avalanche: avalancheDeployments,
} as const satisfies Record<DeploymentNetwork, Deployments>;

export const BENZO_ADDRESSES_BY_CHAIN_ID = {
  [FUJI_CHAIN_ID]: fujiDeployments.contracts,
  [BENZONET_CHAIN_ID]: benzonetDeployments.contracts,
  [AVALANCHE_CHAIN_ID]: avalancheDeployments.contracts,
} as const satisfies Record<DeploymentChainId, BenzoContractAddresses>;

export function networkFromEnv(value: string | undefined): BenzoNetwork {
  if (value === "benzonet") return "benzonet";
  if (value === "avalanche" || value === "mainnet" || value === "public") return "avalanche";
  return "fuji";
}

export function chainForNetwork(network: BenzoNetwork): Chain {
  return BENZO_CHAIN_BY_NETWORK[network];
}

export function addressesForChain(chainId: number): BenzoContractAddresses {
  return (
    BENZO_ADDRESSES_BY_CHAIN_ID[chainId as DeploymentChainId] ??
    BENZO_ADDRESSES_BY_CHAIN_ID[FUJI_CHAIN_ID]
  );
}
