import { describe, expect, it } from "vitest";
import {
  AVALANCHE_CHAIN_ID,
  BENZO_ADDRESSES_BY_CHAIN_ID,
  BENZONET_CHAIN_ID,
  FUJI_CHAIN_ID,
  addressesForChain,
  networkFromEnv,
} from "../src/index.js";

function collectHexStrings(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith("0x") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectHexStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectHexStrings);
  }
  return [];
}

describe("@benzo/config deployments", () => {
  it("exposes real deployments for Fuji, BenzoNet, and Avalanche mainnet", () => {
    expect(Object.keys(BENZO_ADDRESSES_BY_CHAIN_ID).map(Number).sort()).toEqual([
      FUJI_CHAIN_ID,
      AVALANCHE_CHAIN_ID,
      BENZONET_CHAIN_ID,
    ].sort());

    const avalanche = addressesForChain(AVALANCHE_CHAIN_ID);

    expect(avalanche.eerc).toBe("0x708d0b83461973F46041a36f588b8760dbC0Db0e");
    expect(avalanche.EncryptedERC).toBe(avalanche.eerc);
    expect(avalanche.registrar).toBe("0x902B8D5585A5124C9B9c001A95b7f520C07a79F2");
    expect(avalanche.verifiers.transfer).toBe("0x4A716026a0C1F7158165520B6DF2009fFeB79f01");
    expect(avalanche.tokens.USDC).toEqual({
      address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      decimals: 6,
      tokenId: 1,
      symbol: "USDC",
    });

    expect(addressesForChain(BENZONET_CHAIN_ID).tokens.tUSDC?.tokenId).toBe(1);
  });

  it("does not expose zero-address placeholders", () => {
    const addresses = collectHexStrings(BENZO_ADDRESSES_BY_CHAIN_ID);

    expect(addresses).not.toHaveLength(0);
    expect(addresses.every((address) => !address.startsWith("0x000"))).toBe(true);
  });

  it("normalizes new network aliases and keeps the Fuji fallback", () => {
    expect(networkFromEnv("benzonet")).toBe("benzonet");
    expect(networkFromEnv("mainnet")).toBe("avalanche");
    expect(addressesForChain(1)).toBe(BENZO_ADDRESSES_BY_CHAIN_ID[FUJI_CHAIN_ID]);
  });
});
