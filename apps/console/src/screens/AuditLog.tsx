/**
 * Audit log - the tamper-evident double-entry ledger, finally on screen. Every
 * shielded movement projects to a balanced entry whose hash commits to the one
 * before it, so any after-the-fact edit/insert/delete breaks the chain from that
 * point on. "Generate auditor packet" re-walks the chain, folds every encrypted
 * event under one Merkle root, and anchors that root on-chain - one full-screen,
 * re-verifiable disclosure. Each entry links to its on-chain settlement. This is
 * the CFO/auditor-readable side of private money.
 */
import { useEffect, useReducer, useState } from "react";
import { CheckCircle2, Download, ExternalLink, ScrollText, ShieldAlert } from "lucide-react";
import type { LedgerEntry, LedgerSourceType } from "@benzo/types";
import { initialPaymentState, paymentReducer } from "@benzo/ui/payment-state";
import { api, type PrivateAuditAnchorResponse, type PrivateAuditPacketResponse } from "../lib/api";
import { explorerTxUrl, fmtUsd, formatAddress, formatDate, friendlyError } from "../lib/format";
import { CeremonyRow } from "../ui/CeremonyRow";
import { Screen, Stagger } from "../ui/motion";
import { SendCeremony, type CeremonyTitles } from "../ui/SendCeremony";
import { Button, Card, EmptyState, Pill, Skeleton } from "../ui/primitives";

const sourceTone: Record<LedgerSourceType, "shielded" | "success" | "warning" | "danger" | "muted"> = {
  shield: "shielded",
  transfer: "shielded",
  payroll: "success",
  invoice: "success",
  unshield: "warning",
  onramp: "success",
  offramp: "warning",
  fee: "muted",
  reversal: "danger",
};

// Prove-flavored copy for the shared send ceremony. The packet is only "verified"
// once its Merkle root is anchored on-chain; anything short of that fails clearly.
const PACKET_TITLES: CeremonyTitles = {
  encrypt: { title: "Re-walking the audit chain", sub: "Re-hashing every entry and gathering the encrypted events" },
  settle: { title: "Folding the audit proof", sub: "Committing the Merkle root and anchoring it on-chain" },
  verify: { title: "Anchored on-chain — Merkle root revealed", sub: "Here's your downloadable, re-verifiable packet" },
  error: { title: "Couldn't seal the packet" },
};

/** Gross of an entry = sum of its credit legs (debits net to the same number). */
function entryGross(e: LedgerEntry): string {
  return e.lines.filter((l) => l.direction === "credit").reduce((s, l) => s + BigInt(l.amount), 0n).toString();
}

export function AuditLog() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "Generate auditor packet" is one full-screen action, driven by the shared
  // payment state machine so verify -> fold -> anchor plays honestly.
  const [packetState, dispatchPacket] = useReducer(paymentReducer, initialPaymentState);
  const [integrity, setIntegrity] = useState<{ ok: boolean; length: number; brokenAt?: number } | null>(null);
  const [packet, setPacket] = useState<PrivateAuditPacketResponse["packet"] | null>(null);
  const [anchor, setAnchor] = useState<PrivateAuditAnchorResponse["anchor"] | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadError(null);
    api
      .ledger()
      .then((r) => live && setEntries(r))
      .catch((e) => {
        if (!live) return;
        setLoadError(friendlyError(e, "Couldn't load the audit log."));
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  // One action: re-walk the tamper-evident chain, fold the encrypted events under a
  // Merkle root, anchor that root on-chain. The ceremony is a slave to the result -
  // it only reaches "verified" if the root actually anchored on-chain.
  async function generatePacket() {
    dispatchPacket({ type: "START" });
    setIntegrity(null);
    setPacket(null);
    setAnchor(null);
    try {
      const chain = await api.ledgerVerify();
      setIntegrity(chain);
      if (!chain.ok) {
        const at = chain.brokenAt != null ? `entry #${chain.brokenAt}` : "an entry";
        dispatchPacket({ type: "FAIL", error: `Tampering detected at ${at}. The chain is broken from there on.` });
        return;
      }
      dispatchPacket({ type: "WITNESS_READY" });

      const built = await api.privateAuditPacket();
      setPacket(built.packet);
      if (!built.integrity.ok) {
        const at = built.integrity.brokenAt != null ? `entry #${built.integrity.brokenAt}` : "an entry";
        dispatchPacket({ type: "FAIL", error: `The private event chain failed integrity at ${at}.` });
        return;
      }
      dispatchPacket({ type: "PROOF_READY" });

      const anchored = await api.anchorPrivateAuditRoot({ packet: built.packet });
      setPacket(anchored.packet);
      setAnchor(anchored.anchor);
      if (anchored.anchor.onChain) {
        dispatchPacket({ type: "SUBMITTED", txHash: anchored.anchor.txHash ?? "" });
        dispatchPacket({ type: "CONFIRMED", result: anchored });
      } else {
        dispatchPacket({ type: "FAIL", error: anchored.anchor.error ?? "The audit root was not anchored on-chain. Connect to a live network for a re-verifiable packet." });
      }
    } catch (e) {
      dispatchPacket({ type: "FAIL", error: friendlyError(e, "Couldn't generate the auditor packet.") });
    }
  }

  function downloadPacket() {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benzo-auditor-packet-${packet.scope.label}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Screen>
      <SendCeremony
        open={packetState.phase !== "idle"}
        state={packetState}
        eyebrow="Auditor packet"
        titles={PACKET_TITLES}
        details={<CeremonyRow k="Scope" v={packet?.scope.label ?? "All private events"} />}
        receipt={
          packetState.phase === "confirmed" && packet ? (
            <div className="space-y-2" data-testid="packet-receipt">
              <div className="flex items-center gap-2 font-semibold text-white">
                <CheckCircle2 size={15} /> Chain intact · {integrity?.length ?? packet.envelopes.length} entries verified
              </div>
              <div className="text-[12px] text-white/56">
                {packet.envelopes.length} encrypted events sealed under one Merkle root. Records stay ciphertext; only the root goes on-chain.
              </div>
              <div className="font-mono text-[12px] text-white/56">Merkle root {formatAddress(packet.anchor.merkleRoot, 8, 6)}</div>
              {anchor?.onChain ? (
                <div className="font-mono text-[12px] text-white/56">On-chain · sequence {anchor.sequence}</div>
              ) : null}
              {anchor?.explorer ? (
                <a href={anchor.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                  View root transaction <ExternalLink size={12} />
                </a>
              ) : null}
            </div>
          ) : undefined
        }
        primaryAction={
          packetState.phase === "confirmed"
            ? { label: (<><Download size={14} /> Download packet (.json)</>), onClick: downloadPacket }
            : packetState.phase === "failed"
              ? { label: "Close", onClick: () => dispatchPacket({ type: "RESET" }), variant: "danger" }
              : undefined
        }
        secondaryAction={
          packetState.phase === "confirmed"
            ? { label: "Done", onClick: () => dispatchPacket({ type: "RESET" }), variant: "outline" }
            : undefined
        }
      />

      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Audit log</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            A tamper-evident double-entry record of every movement. Balances are derived from these; corrections are reversals, never edits.
          </p>
        </div>
      </div>

      <Card className="mb-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <ScrollText size={16} className="text-primary" /> Auditor packet
            </div>
            <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
              Re-walk the tamper-evident chain, fold every encrypted event under one Merkle root, and anchor that root on-chain - one signed, re-verifiable packet an auditor can check without trusting Benzo. Records stay ciphertext; only hashes and the root go on-chain.
            </p>
          </div>
          <Button className="flex-none" onClick={generatePacket} data-testid="generate-packet">
            <ShieldAlert size={15} /> Generate auditor packet
          </Button>
        </div>
      </Card>

      {loadError && entries === null ? (
        <Card className="p-8 text-center">
          <div className="text-sm font-medium text-fg">{loadError}</div>
          <div className="mt-3">
            <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)} data-testid="audit-retry">Try again</Button>
          </div>
        </Card>
      ) : entries === null ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="h-11 w-11 flex-none rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-20 flex-none" />
            </Card>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title="No entries yet" hint="Ledger entries appear here as soon as money moves: a shield, a payroll run, an invoice paid." />
      ) : (
        <Stagger className="space-y-4">
          {entries.map((e, i) => (
            <Stagger.Item key={e.id} index={i}>
              <Card className="flex items-center gap-4 p-4">
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ScrollText size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Pill tone={sourceTone[e.sourceType] ?? "muted"}>{e.sourceType}</Pill>
                    <span className="truncate text-[12.5px] text-muted">{formatDate(e.postedAt)}</span>
                    {e.reversalOf ? <span className="text-[11.5px] font-semibold text-danger">reversal</span> : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] text-muted">
                    <span className="font-mono" title="audit hash (commits to the previous entry)">
                      {e.hash ? formatAddress(e.hash, 8, 6) : "-"}
                    </span>
                    {e.txId ? (
                      <a href={explorerTxUrl(e.txId)} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                        on-chain receipt
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="font-display flex-none text-right text-[15px] text-fg">{fmtUsd(entryGross(e))}</div>
              </Card>
            </Stagger.Item>
          ))}
        </Stagger>
      )}
    </Screen>
  );
}
