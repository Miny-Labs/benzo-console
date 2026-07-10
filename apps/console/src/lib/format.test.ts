import { describe, expect, it } from "vitest";
import { explorerContractUrl, explorerTxUrl, fmtUsd, formatAddress, formatMoney } from "./format";

describe("console money formatting", () => {
  it("fmtUsd renders dollar-prefixed, fixed 2 decimals", () => {
    expect(fmtUsd("842300000000")).toBe("$842,300.00");
    expect(fmtUsd("1950000")).toBe("$1.95");
    expect(fmtUsd("3500000000")).toBe("$3,500.00");
    expect(fmtUsd("0")).toBe("$0.00");
  });
  it("formatMoney keeps real precision with a code suffix", () => {
    expect(formatMoney("124050000")).toBe("124.05 USDC");
  });
  it("formatAddress truncates long EVM addresses", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x12…5678");
    expect(formatAddress("short")).toBe("short");
  });
  it("builds BenzoNet explorer links by default (the console's L1)", () => {
    expect(explorerTxUrl("abc123")).toBe("https://explorer.benzo.space/tx/abc123");
    expect(explorerContractUrl("0xabc")).toBe("https://explorer.benzo.space/address/0xabc");
  });
});
