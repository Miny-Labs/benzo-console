/**
 * Treasury - the org's managed encrypted treasury.
 *
 * This screen is intentionally org-scoped. The managed treasury address,
 * encrypted balances, direct ERC-20 deposit action, and deposit history all come
 * from services/api under /orgs/:id/treasury.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, CheckCircle2, Clock3, ShieldCheck, Wallet } from "lucide-react";
import type { DepositToTreasuryResponse, TreasuryDeposit, TreasuryToken } from "@benzo/types";
import { api, randomIdempotencyKey } from "../lib/api";
import { useConsole } from "../lib/store";
import { explorerTxUrl, fmtDateTime, formatAddress, formatMoney, friendlyError, usdcToMinor } from "../lib/format";
import { NETWORK_LABEL } from "../lib/network";
import { Screen } from "../ui/motion";
import {
  Amount,
  Button,
  Card,
  CopyButton,
  Input,
  PageHeader,
  Pill,
  ShieldedBadge,
  Skeleton,
  StatusPill,
  Table,
  Td,
  Th,
  useToast,
} from "../ui/primitives";

const DEPOSIT_LIMIT = 10;
const MINOR_UNITS = /^[1-9][0-9]*$/;
// TODO(cctp): add cross-chain fund-intent once services/api exposes it.
const FUNDING_TOKEN: TreasuryToken = "usdc";

const TOKEN_META: Record<TreasuryToken, { symbol: string; decimals: number }> = {
  usdc: { symbol: "USDC", decimals: 6 },
  eurc: { symbol: "EURC", decimals: 6 },
};

function cleanAmount(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  if (rest.length === 0) return whole;
  return `${whole}.${rest.join("").slice(0, 6)}`;
}

function depositStatusLabel(status: DepositToTreasuryResponse["status"]): string {
  return status === "confirmed" ? "Deposit confirmed" : "Deposit submitted";
}

function canManageTreasury(role?: string | null): boolean {
  return role === "owner" || role === "admin";
}

export function Treasury() {
  const toast = useToast();
  const { session, treasury, masked, loading, refresh } = useConsole();
  const activeOrg = session?.activeOrg ?? null;
  const activeOrgId = activeOrg?.id;
  const canAddFunds = canManageTreasury(session?.role);

  const [amount, setAmount] = useState("1000");
  const [busyDeposit, setBusyDeposit] = useState(false);
  const [depositResult, setDepositResult] = useState<DepositToTreasuryResponse | null>(null);
  const [deposits, setDeposits] = useState<TreasuryDeposit[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositsError, setDepositsError] = useState<string | null>(null);

  const depositMinor = useMemo(() => {
    try {
      return usdcToMinor(amount);
    } catch {
      return "0";
    }
  }, [amount]);
  const amountError = amount && !MINOR_UNITS.test(depositMinor) ? "Enter at least 0.000001 USDC." : undefined;
  const usdcBalance = treasury?.balances.find((b) => b.token === "usdc");
  const registered = treasury?.registered ?? false;

  const loadDeposits = useCallback(async () => {
    if (!activeOrgId) {
      setDeposits([]);
      setDepositsError(null);
      return;
    }
    setDepositsLoading(true);
    try {
      const response = await api.treasuryDeposits(activeOrgId, { limit: DEPOSIT_LIMIT });
      setDeposits(response.deposits);
      setDepositsError(null);
    } catch (e) {
      setDepositsError(friendlyError(e, "Couldn't load treasury deposits."));
    } finally {
      setDepositsLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void loadDeposits();
  }, [loadDeposits]);

  async function addFunds() {
    if (!activeOrgId) return;
    let minor = "0";
    try {
      minor = usdcToMinor(amount);
    } catch {
      setDepositResult(null);
      return;
    }
    if (!MINOR_UNITS.test(minor)) {
      setDepositResult(null);
      return;
    }
    setBusyDeposit(true);
    setDepositResult(null);
    try {
      const result = await api.depositToTreasury(activeOrgId, {
        amount: minor,
        token: FUNDING_TOKEN,
        idempotencyKey: randomIdempotencyKey(),
      });
      setDepositResult(result);
      toast({ title: `${depositStatusLabel(result.status)} - ${formatMoney(result.amount, TOKEN_META[result.token].decimals, TOKEN_META[result.token].symbol)}`, tone: "success" });
      setAmount("");
      await Promise.allSettled([refresh(), loadDeposits()]);
    } catch (e) {
      toast({ title: friendlyError(e, "Couldn't add funds."), tone: "danger" });
    } finally {
      setBusyDeposit(false);
    }
  }

  if (!activeOrg) {
    return (
      <Screen>
        <PageHeader title="Treasury" subtitle="Create or select a workspace to view its managed treasury." />
        <Card className="p-10 text-center text-sm text-muted">No active workspace.</Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Treasury" subtitle={`Managed encrypted treasury for ${activeOrg.name}.`} />

      <div className="mb-6 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="t-label text-muted">Managed treasury</div>
              <div className="t-card-title mt-1 text-fg">Server-custodied eERC account</div>
            </div>
            {registered ? (
              <Pill tone="success">
                <CheckCircle2 size={12} /> Registered
              </Pill>
            ) : (
              <Pill tone="warning">
                <Clock3 size={12} /> Registration pending
              </Pill>
            )}
          </div>

          {loading && !treasury ? (
            <div className="mt-5 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : treasury ? (
            <>
              <div className="mt-5 rounded-lg border border-border bg-bg px-4 py-3">
                <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted">Treasury address</div>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-all font-mono text-[12.5px] text-fg" data-testid="treasury-address">{treasury.address}</span>
                  <span className="flex-none"><CopyButton value={treasury.address} /></span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Meta label="Custody" value="Managed" />
                <Meta label="Consent" value={treasury.custodyConsent.consented ? "Consented" : "Pending"} />
                <Meta label="Network" value={NETWORK_LABEL} />
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 text-[13px] text-warning">
              Treasury details are unavailable right now.
            </div>
          )}
        </Card>

        <Card className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2">
            <span className="t-label text-muted">Primary encrypted balance</span>
            <ShieldedBadge label="Encrypted" />
          </div>
          {loading && !treasury ? (
            <Skeleton className="mt-3 h-10 w-56" />
          ) : (
            <div className="mt-3 flex items-baseline gap-1.5" data-testid="treasury-total">
              <span className="font-display tnum text-[40px] leading-none text-fg">
                {masked ? "••••••" : formatMoney(usdcBalance?.amount ?? "0", usdcBalance?.decimals ?? 6, "")}
              </span>
              {!masked ? <span className="t-helper">{usdcBalance?.symbol ?? "USDC"}</span> : null}
            </div>
          )}
          <p className="t-helper mt-2">Decoded for authorized workspace members; private on-chain.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 t-card-title text-fg">
              <ArrowDownToLine size={16} className="text-primary" /> Add funds
            </div>
            <p className="t-helper mt-1">Direct ERC-20 deposit into the managed encrypted treasury.</p>

            <div className="mt-4">
              <Input
                label="Amount"
                hint="USDC"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setDepositResult(null);
                  setAmount(cleanAmount(e.target.value));
                }}
                error={amountError}
                data-testid="fund-amount"
              />
            </div>

            <dl className="mt-4 divide-y divide-border rounded-lg border border-border bg-bg px-4 py-2 text-sm">
              <KV label="Token" value="USDC" />
              <KV label="Deposit amount" value={MINOR_UNITS.test(depositMinor) ? <Amount minor={depositMinor} code="USDC" /> : "-"} />
              <KV label="Source" value="Direct ERC-20" />
              <KV label="Destination" value="Encrypted treasury" />
            </dl>

            <Button
              className="mt-4 w-full"
              loading={busyDeposit}
              disabled={!canAddFunds || !registered || !!amountError || !MINOR_UNITS.test(depositMinor)}
              onClick={addFunds}
              data-testid="add-funds"
            >
              <Wallet size={15} /> Add funds
            </Button>
            {!canAddFunds ? <p className="mt-2 text-[12px] text-muted">Only workspace owners and admins can add treasury funds.</p> : null}
            {!registered ? <p className="mt-2 text-[12px] text-warning">Treasury registration must complete before deposits are accepted.</p> : null}
            {depositResult ? <DepositResult result={depositResult} /> : null}
          </Card>

          <Card>
            <div className="flex items-center gap-2 t-card-title text-fg">
              <ShieldCheck size={16} className="text-shielded" /> Encrypted balances
            </div>
            <div className="mt-4 space-y-3">
              {loading && !treasury ? (
                [0, 1].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                ))
              ) : (treasury?.balances ?? []).length === 0 ? (
                <div className="rounded-lg border border-border bg-bg px-4 py-6 text-center text-[13px] text-muted">No encrypted balances yet.</div>
              ) : (
                treasury?.balances.map((balance) => (
                  <div key={balance.tokenId} className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3" data-testid={`balance-${balance.token}`}>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-fg">{balance.symbol}</div>
                      <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">{balance.tokenId}</div>
                    </div>
                    <div className="tnum text-right text-[15px] font-semibold text-fg">
                      {masked ? "••••••" : formatMoney(balance.amount, balance.decimals, balance.symbol)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="t-card-title text-fg">Recent deposits</div>
            <Button variant="outline" size="sm" onClick={() => void loadDeposits()} disabled={depositsLoading} data-testid="refresh-deposits">
              Refresh
            </Button>
          </div>

          {depositsError ? (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/8 px-4 py-3 text-[13px] text-danger">{depositsError}</div>
          ) : null}

          {depositsLoading && deposits.length === 0 ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : deposits.length === 0 ? (
            <div className="mt-4 rounded-lg border border-border bg-bg px-4 py-8 text-center text-[13px] text-muted">No deposits yet.</div>
          ) : (
            <Table className="mt-4">
              <thead>
                <tr>
                  <Th>Deposit</Th>
                  <Th>Status</Th>
                  <Th align="right">Amount</Th>
                  <Th>Tx</Th>
                  <Th>Time</Th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((deposit) => (
                  <tr key={deposit.id} data-testid={`deposit-${deposit.id}`}>
                    <Td>
                      <div className="font-medium capitalize text-fg">{deposit.kind}</div>
                      <div className="mt-0.5 text-[12px] text-muted">{deposit.sourceChain}</div>
                    </Td>
                    <Td><StatusPill status={deposit.status} /></Td>
                    <Td align="right">
                      <span className="tnum font-medium">{formatDepositAmount(deposit)}</span>
                    </Td>
                    <Td>
                      <a href={explorerTxUrl(deposit.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
                        <span className="font-mono">{formatAddress(deposit.txHash, 4, 4)}</span> <ArrowUpRight size={12} />
                      </a>
                    </Td>
                    <Td className="whitespace-nowrap text-[12.5px] text-muted">{fmtDateTime(deposit.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </Screen>
  );
}

function formatDepositAmount(deposit: TreasuryDeposit): string {
  const meta = TOKEN_META[deposit.token];
  return formatMoney(deposit.amount, meta.decimals, meta.symbol);
}

function DepositResult({ result }: { result: DepositToTreasuryResponse }) {
  const meta = TOKEN_META[result.token];
  const confirmed = result.status === "confirmed";
  return (
    <div className={`mt-4 rounded-lg border px-4 py-3 ${confirmed ? "border-success/30 bg-success/8" : "border-warning/30 bg-warning/8"}`} data-testid="deposit-result">
      <div className={`flex items-center gap-1.5 text-[13px] font-semibold ${confirmed ? "text-success" : "text-warning"}`}>
        {confirmed ? <CheckCircle2 size={14} /> : <Clock3 size={14} />} {depositStatusLabel(result.status)}
      </div>
      <div className="mt-1 text-[12.5px] text-muted">{formatMoney(result.amount, meta.decimals, meta.symbol)} via direct deposit.</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <a href={explorerTxUrl(result.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
          View deposit tx <ArrowUpRight size={12} />
        </a>
        {result.approvalTxHash ? (
          <a href={explorerTxUrl(result.approvalTxHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40">
            View approval tx <ArrowUpRight size={12} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-fg">{value}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );
}
