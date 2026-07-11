/**
 * format.ts, money parse/format round-trips and identifier truncation. The
 * parse path must refuse to silently drop a user's cents (over-precision throws).
 */
import { describe, it, expect } from "vitest";
import {
  formatUsdc,
  parseUsdc,
  truncateAddress,
  truncateHash,
  formatHandle,
  USDC_DECIMALS,
} from "../src/format.js";

describe("formatUsdc", () => {
  it("formats base units with grouping and >=2 decimals", () => {
    expect(formatUsdc(0n)).toBe("0.00");
    expect(formatUsdc(1_000_000n)).toBe("1.00"); // 1 USDC = 1e6 base units
    expect(formatUsdc(1_234_550_000n)).toBe("1,234.55");
    expect(formatUsdc(150_000n)).toBe("0.15");
    expect(formatUsdc(1_000_000n, { symbol: "USDC" })).toBe("1.00 USDC");
  });
  it("keeps full precision when present and handles negatives", () => {
    expect(formatUsdc(1_000_001n)).toBe("1.000001");
    expect(formatUsdc(-250_000n)).toBe("-0.25");
  });
});

describe("parseUsdc", () => {
  it("round-trips with formatUsdc through base units", () => {
    for (const s of ["0", "1", "1234.55", "0.15", "9999999.999999"]) {
      const base = parseUsdc(s);
      expect(parseUsdc(formatUsdc(base))).toBe(base);
    }
    expect(parseUsdc("1,234.50")).toBe(1_234_500_000n);
    expect(USDC_DECIMALS).toBe(6);
  });
  it("throws on malformed input and on over-precision", () => {
    expect(() => parseUsdc("")).toThrow();
    expect(() => parseUsdc("abc")).toThrow();
    expect(() => parseUsdc("1.2345678")).toThrow(/decimal places/); // 7 > 6
  });
});

describe("truncation + handle", () => {
  it("middle-truncates long ids but leaves short ones", () => {
    expect(truncateAddress("0x1234567890abcdef")).toBe("0x123…cdef");
    expect(truncateAddress("0x123")).toBe("0x123");
    expect(truncateHash("a".repeat(64))).toBe("aaaaaa…aaaa");
  });
  it("normalizes a handle to a single @", () => {
    expect(formatHandle("alice")).toBe("@alice");
    expect(formatHandle("@@bob ")).toBe("@bob");
  });
});
