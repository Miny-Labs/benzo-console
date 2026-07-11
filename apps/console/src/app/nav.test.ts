import { describe, expect, it } from "vitest";
import { NAV_ITEMS, REAL_HOME, visibleNavGroups, visibleNavItems } from "./nav";

describe("real-mode nav gating", () => {
  it("real mode exposes only the backend-backed screens (Payroll + Treasury)", () => {
    const tos = visibleNavItems(false)
      .map((i) => i.to)
      .sort();
    expect(tos).toEqual(["/payroll", "/treasury"]);
  });

  it("real mode hides every no-backend screen", () => {
    const tos = new Set(visibleNavItems(false).map((i) => i.to));
    for (const hidden of ["/", "/contractors", "/invoices", "/pay", "/approvals", "/grants", "/audit", "/settings"]) {
      expect(tos.has(hidden)).toBe(false);
    }
  });

  it("demo mode shows the full product", () => {
    const items = visibleNavItems(true);
    expect(items).toHaveLength(NAV_ITEMS.length);
    expect(items.some((i) => i.to === "/contractors")).toBe(true);
    expect(items.some((i) => i.to === "/settings")).toBe(true);
  });

  it("real-mode groups collapse to the two wired sections, in order", () => {
    expect(visibleNavGroups(false)).toEqual(["Payments", "Operations"]);
  });

  it("demo-mode keeps all non-footer sections", () => {
    expect(visibleNavGroups(true)).toEqual(["Overview", "Payments", "Operations", "Compliance"]);
  });

  it("real mode lands on the treasury (Overview has no backend)", () => {
    expect(REAL_HOME).toBe("/treasury");
    // the landing must itself be a real-backed screen
    const landing = NAV_ITEMS.find((i) => i.to === REAL_HOME);
    expect(landing?.realBacked).toBe(true);
  });
});
