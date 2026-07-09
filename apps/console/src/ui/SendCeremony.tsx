import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, LockKeyhole, ReceiptText, Send } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import type { PaymentPhase, PaymentState } from "@benzo/ui/payment-state";
import {
  SEND_PHASE_SLOW_MS,
  SEND_RAIL_LABELS,
  ceremonyPhase,
  sendCeremonyView,
} from "@benzo/ui/send-sequence";
import { AnimatePresence, EASE, motion, spring } from "./motion";
import { Button } from "./primitives";

type CeremonyAction = {
  label: ReactNode;
  onClick: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger";
};

export function SendCeremony({
  open,
  state,
  eyebrow = "Private send",
  details,
  receipt,
  primaryAction,
  secondaryAction,
}: {
  open: boolean;
  state: PaymentState;
  eyebrow?: ReactNode;
  details?: ReactNode;
  receipt?: ReactNode;
  primaryAction?: CeremonyAction;
  secondaryAction?: CeremonyAction;
}) {
  const reduce = useReducedMotion() ?? false;
  const visibleState = useFlooredPaymentState(open, state, reduce);
  const view = sendCeremonyView(visibleState, { prover: "local", reducedMotion: reduce });
  const [lastStep, setLastStep] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (view.step >= 0) setLastStep(view.step);
  }, [view.step]);

  useEffect(() => {
    setSlow(false);
    if (!open || view.failed) return;
    const slowMs = view.phase === "encrypt" ? SEND_PHASE_SLOW_MS.encrypt : view.phase === "settle" ? SEND_PHASE_SLOW_MS.settle : 0;
    if (!slowMs) return;
    const timer = window.setTimeout(() => setSlow(true), slowMs);
    return () => window.clearTimeout(timer);
  }, [open, view.failed, view.phase]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/88 px-4 py-8 backdrop-blur-md"
          data-testid="send-ceremony"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          <motion.div
            className="relative flex min-h-[500px] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#161E2D] text-white shadow-[0_30px_90px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={spring}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(115,66,226,0.28),transparent_34%),linear-gradient(180deg,rgba(242,242,238,0.08),transparent_38%)]" />
            <div className="relative flex flex-1 flex-col p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">
                <span>{eyebrow}</span>
                <span>{view.done ? "Receipt ready" : view.failed ? "Stopped" : "In progress"}</span>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                <CeremonyGlyph phase={view.phase} animate={view.animate} />
                <motion.h2
                  key={view.title}
                  className="mt-7 font-display text-3xl text-white"
                  initial={view.animate ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: EASE }}
                >
                  {view.title}
                </motion.h2>
                <p className={`mt-2 max-w-md text-sm leading-relaxed ${view.failed ? "text-danger" : "text-white/64"}`}>
                  {view.sub}
                </p>
                {slow ? (
                  <p className="mt-3 text-[12.5px] text-white/48">
                    This can take a little longer when the local proof or ledger close is busy.
                  </p>
                ) : null}

                {details ? (
                  <div className="mt-8 w-full max-w-md rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left text-sm text-white/76">
                    {details}
                  </div>
                ) : null}

                {view.done || view.failed ? (
                  <motion.div
                    className="mt-4 w-full max-w-md rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-white/74"
                    initial={view.animate ? { opacity: 0, y: 8 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: EASE }}
                  >
                    {receipt ?? <DefaultReceipt state={visibleState} failed={view.failed} />}
                  </motion.div>
                ) : null}
              </div>

              <div className="relative">
                <ol className="grid grid-cols-3 gap-2" aria-label="Send progress">
                  {SEND_RAIL_LABELS.map((label, index) => {
                    const status = view.failed && index === lastStep ? "failed" : index < view.step ? "done" : index === view.step ? "active" : "pending";
                    return <RailStep key={label} label={label} status={status} />;
                  })}
                </ol>
                {(view.done || view.failed) && (primaryAction || secondaryAction) ? (
                  <div className="mt-5 flex justify-end gap-2">
                    {secondaryAction ? (
                      <Button variant={secondaryAction.variant ?? "outline"} onClick={secondaryAction.onClick}>
                        {secondaryAction.label}
                      </Button>
                    ) : null}
                    {primaryAction ? (
                      <Button variant={primaryAction.variant ?? (view.failed ? "danger" : "primary")} onClick={primaryAction.onClick}>
                        {primaryAction.label}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// Ordered ceremony beats + a representative payment phase for each. When the
// underlying machine JUMPS (all events dispatched in one batched render, so
// React only ever renders building -> confirmed), the flooring must still walk
// through the intermediate "settle" beat instead of mapping encrypt -> verify
// directly. That honesty is the whole point of the ceremony.
const CEREMONY_ORDER = ["encrypt", "settle", "verify"] as const;
type OrderedPhase = (typeof CEREMONY_ORDER)[number];
const PHASE_FOR_CEREMONY: Record<OrderedPhase, PaymentPhase> = {
  encrypt: "proving",
  settle: "submitting",
  verify: "confirmed",
};

function useFlooredPaymentState(open: boolean, state: PaymentState, reducedMotion: boolean) {
  const [visibleState, setVisibleState] = useState(state);
  const phaseStartedAt = useRef(Date.now());

  useEffect(() => {
    if (!open) {
      setVisibleState(state);
      phaseStartedAt.current = Date.now();
      return;
    }

    const currentPhase = ceremonyPhase(visibleState.phase);
    const nextPhase = ceremonyPhase(state.phase);
    // At the target (or an error / reduced-motion short-circuit): reflect reality.
    if (currentPhase === nextPhase || nextPhase === "error" || reducedMotion) {
      if (visibleState !== state) setVisibleState(state);
      if (currentPhase !== nextPhase) phaseStartedAt.current = Date.now();
      return;
    }

    // Advance exactly ONE ceremony beat toward the target, holding the current
    // beat for its floor. Re-running on visibleState change walks the remaining
    // beats — so a batched encrypt -> confirmed jump still plays "Settling".
    const ci = CEREMONY_ORDER.indexOf(currentPhase as OrderedPhase);
    const ni = CEREMONY_ORDER.indexOf(nextPhase as OrderedPhase);
    const stepPhase: OrderedPhase | typeof nextPhase = ci >= 0 && ni > ci + 1 ? CEREMONY_ORDER[ci + 1] : nextPhase;
    const stepState: PaymentState =
      stepPhase === nextPhase ? state : { ...state, phase: PHASE_FOR_CEREMONY[stepPhase as OrderedPhase] };

    const currentView = sendCeremonyView(visibleState, { reducedMotion });
    const wait = Math.max(currentView.floorMs - (Date.now() - phaseStartedAt.current), 0);
    const timer = window.setTimeout(() => {
      setVisibleState(stepState);
      phaseStartedAt.current = Date.now();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [open, reducedMotion, state, visibleState]);

  return visibleState;
}

function CeremonyGlyph({ phase, animate }: { phase: ReturnType<typeof ceremonyPhase>; animate: boolean }) {
  const icon = phase === "error" ? <AlertTriangle size={34} /> : phase === "verify" ? <Check size={36} /> : phase === "settle" ? <Send size={34} /> : <LockKeyhole size={34} />;
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      <motion.span
        className="absolute inset-0 rounded-full border border-primary/35"
        animate={animate && phase !== "error" && phase !== "verify" ? { scale: [1, 1.18, 1], opacity: [0.6, 0.18, 0.6] } : { scale: 1, opacity: 0.5 }}
        transition={{ duration: 1.6, repeat: animate ? Infinity : 0, ease: "easeInOut" }}
      />
      <motion.span
        className={`flex h-20 w-20 items-center justify-center rounded-full border ${
          phase === "error" ? "border-danger/40 bg-danger/12 text-danger" : "border-primary/30 bg-primary/18 text-white"
        }`}
        animate={animate && phase === "settle" ? { rotate: [0, 5, -5, 0] } : { rotate: 0 }}
        transition={{ duration: 1.4, repeat: animate && phase === "settle" ? Infinity : 0, ease: EASE }}
      >
        {icon}
      </motion.span>
    </div>
  );
}

function RailStep({ label, status }: { label: ReactNode; status: "done" | "active" | "pending" | "failed" }) {
  const dot =
    status === "done"
      ? "border-success bg-success text-[#10261b]"
      : status === "active"
        ? "border-primary bg-primary text-white"
        : status === "failed"
          ? "border-danger bg-danger text-white"
          : "border-white/18 bg-white/[0.03] text-white/45";
  return (
    <li className="min-w-0">
      <div className={`flex h-9 items-center gap-2 rounded-full border px-2.5 text-[12px] font-semibold ${dot}`}>
        <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full border border-current text-[10px]">
          {status === "done" ? <Check size={11} /> : null}
        </span>
        <span className="truncate">{label}</span>
      </div>
    </li>
  );
}

function DefaultReceipt({ state, failed }: { state: PaymentState; failed: boolean }) {
  if (failed) return <span>{state.error ?? "No funds moved."}</span>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 font-semibold text-white">
        <ReceiptText size={15} /> Private receipt
      </div>
      {state.txHash ? <div className="font-mono text-[12px] text-white/56">{state.txHash}</div> : <div className="text-white/56">Settlement confirmed.</div>}
    </div>
  );
}
