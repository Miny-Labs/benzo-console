import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pay } from "./Pay";

const apiMock = vi.hoisted(() => ({
  createPayment: vi.fn(),
}));
const refreshMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../lib/store", () => ({
  useConsole: () => ({
    accounts: [{ id: "acct_1", name: "Operating", assetCode: "USDC" }],
    counterparties: [
      {
        id: "cp_1",
        name: "Ava Contractor",
        paymentAddress: { shielded: "benzo_shielded_ava" },
      },
    ],
    dashboard: { live: true },
    refresh: refreshMock,
  }),
}));

describe("Pay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the reducer-driven send ceremony while a payment is in flight", async () => {
    apiMock.createPayment.mockReturnValueOnce(new Promise(() => {}));
    render(
      <MemoryRouter>
        <Pay />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("pay-from"), { target: { value: "acct_1" } });
    fireEvent.change(screen.getByTestId("pay-to"), { target: { value: "cp_1" } });
    fireEvent.change(screen.getByTestId("pay-amount"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByTestId("pay-review"));
    fireEvent.click(screen.getByTestId("pay-submit"));

    expect(await screen.findByTestId("send-ceremony")).toHaveTextContent("Encrypting your payment");
    expect(apiMock.createPayment).toHaveBeenCalledWith({
      type: "shielded_transfer",
      fromAccountId: "acct_1",
      toCounterpartyId: "cp_1",
      amount: { amount: "25000000", assetCode: "USDC" },
      memo: undefined,
    });
  });
});
