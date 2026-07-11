/**
 * Business onboarding (P0-B1) - the "same caliber as consumer" front door for the
 * console: sign-in / local workspace unlock → a resumable KYB wizard → register
 * the org's managed treasury → land in the workspace. On Avalanche the KYB
 * decision and proof receipts are coordinated by services/api.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, Building2, Check, FileCheck2, Landmark, Loader2, ScanSearch, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import type { OnboardingStatus, OrgSummary, ProvisionTreasuryResponse } from "@benzo/types";
import { ACTIVE_ORG_KEY, api, type OnboardingStatusSubscription, type SiweNonceResponse } from "../lib/api";
import { friendlyError } from "../lib/format";
import { CHAIN_ID, NETWORK_LABEL } from "../lib/network";
import { useConsole } from "../lib/store";
import { Logo } from "../ui/Logo";
import { StageVideo } from "../ui/StageVideo";
import { EASE } from "../ui/motion";
import { Button, Card } from "../ui/primitives";
import { Field, Input, Select, useToast } from "../ui/controls";

// Team is intentionally NOT a step: it collected nothing and gated nothing (a
// pure read-only placeholder). Its one piece of guidance - "invite an approver,
// maker-checker needs proposer ≠ approver" - now lives on the Review step and is
// carried into the workspace as a first-run checklist item, so it surfaces where
// the user can act on it instead of as an inert ceremony step.
const STEPS = [
  { key: "org", label: "Business", icon: Building2 },
  { key: "kyb", label: "Verification (KYB)", icon: FileCheck2 },
  { key: "zone", label: "Compliance", icon: ShieldCheck },
  { key: "treasury", label: "Treasury", icon: Wallet },
  { key: "review", label: "Review", icon: Sparkles },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { session } = useConsole();
  return session ? <Wizard onDone={onDone} /> : <AuthShell onAuthed={onDone} />;
}

// ----------------------------------------------------------------- auth / SIWE
// The console session is SIWE-backed. The wallet signs only an operator login
// challenge; the org treasury remains server-custodied by services/api.
function buildSiweMessage(address: string, challenge: SiweNonceResponse): string {
  return [
    `${window.location.host} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to the Benzo business console.",
    "",
    `URI: ${window.location.origin}`,
    "Version: 1",
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

function AuthShell({ onAuthed }: { onAuthed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const wrongChain = isConnected && chainId !== CHAIN_ID;

  async function withSiwe() {
    setBusy("siwe");
    setErr(null);
    try {
      let activeAddress = address;
      let activeChainId = chainId;
      if (!activeAddress) {
        const connector = connectors[0];
        if (!connector) throw new Error("No wallet connector is available.");
        const connected = await connectAsync({ connector, chainId: CHAIN_ID });
        activeAddress = connected.accounts[0];
        activeChainId = connected.chainId;
      }
      if (!activeAddress) throw new Error("No wallet address was returned.");
      if (activeChainId !== CHAIN_ID) {
        await switchChainAsync({ chainId: CHAIN_ID });
      }
      const challenge = await api.siweNonce(activeAddress);
      const message = buildSiweMessage(activeAddress, challenge);
      const signature = await signMessageAsync({ message });
      await api.siweVerify(message, signature);
      onAuthed();
    } catch (e) {
      setErr(friendlyError(e, "Sign-in failed. Check your wallet and try again."));
      setBusy(null);
    }
  }

  return (
    <Centered>
      <Card className="w-[420px] p-8 text-center">
        <div className="mx-auto mb-5 flex items-center justify-center gap-2 text-ink">
          <Logo size={26} /> <span className="font-display text-xl">Benzo for Business</span>
        </div>
        <h1 className="font-display text-2xl">Pay your team privately</h1>
        <p className="mt-1.5 text-[13.5px] text-muted">Run payroll and pay vendors on Avalanche. Amounts and recipients stay confidential through eERC.</p>
        <div className="mt-6 space-y-2.5">
          {isConnected ? (
            <div className="flex items-center justify-between rounded-[10px] border border-border bg-canvas px-3.5 py-2 text-[12.5px] text-muted" data-testid="auth-wallet-connected">
              <span>{shortAddress(address)} · {wrongChain ? "wrong network" : NETWORK_LABEL}</span>
              <button type="button" onClick={() => disconnect()} className="font-semibold text-primary">Disconnect</button>
            </div>
          ) : null}
          <Button className="w-full" size="md" loading={busy === "siwe"} onClick={withSiwe} data-testid="auth-siwe">
            {wrongChain ? `Switch to ${NETWORK_LABEL} & sign in` : "Sign in with wallet"}
          </Button>
          <a
            href="mailto:sales@benzo.app?subject=Benzo%20for%20Business%20%E2%80%94%20SSO%20setup"
            className="block w-full rounded-[10px] border border-border py-2.5 text-center text-[13px] font-medium text-muted transition hover:bg-[#f4f3ef]"
          >
            Need Okta or SAML? Contact us
          </a>
        </div>
        {err ? <p className="mt-3 text-[12px] text-danger">{err}</p> : null}
        <p className="mt-5 text-[11.5px] text-muted">
          Sign-In with Ethereum opens your operator session. The managed treasury is provisioned by Benzo services only after explicit consent; this signature never moves funds.
        </p>
      </Card>
    </Centered>
  );
}

// ----------------------------------------------------------------- wizard
interface BusinessDraft {
  name?: string;
  legalName?: string;
  country?: string;
  entityType?: string;
  registrationNumber?: string;
  taxId?: string;
  complianceZoneId?: string;
}

type BusyState = "org" | "onboarding" | "treasury" | "finish" | null;

const EERC_STEPS = [
  { key: "kyc", label: "KYC approval", icon: FileCheck2 },
  { key: "allowlist", label: "Address allowlist", icon: ShieldCheck },
  { key: "gas", label: "Gas drip", icon: Landmark },
  { key: "registration", label: "eERC registration", icon: Wallet },
] as const;

export function Wizard({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const { refresh } = useConsole();
  const streamRef = useRef<OnboardingStatusSubscription | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [draft, setDraft] = useState<BusinessDraft>({ country: "US", entityType: "C-Corp", complianceZoneId: "zone_us" });
  const [createdOrg, setCreatedOrg] = useState<OrgSummary | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<ProvisionTreasuryResponse | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const step = STEPS[stepIdx];
  const set = (p: Partial<BusinessDraft>) => setDraft((d) => ({ ...d, ...p }));
  const slug = slugify(draft.name ?? "");
  const onboardingComplete = onboarding?.status === "complete";

  const canNext =
    step.key === "org" ? !!draft.name?.trim() :
    step.key === "kyb" ? onboardingComplete :
    step.key === "treasury" ? !!treasury?.address :
    true;

  useEffect(() => () => streamRef.current?.close(), []);

  async function createOrg() {
    if (createdOrg) return true;
    const name = draft.name?.trim();
    if (!name) return false;
    setBusy("org");
    try {
      const { org } = await api.createOrg({ name, slug });
      localStorage.setItem(ACTIVE_ORG_KEY, org.id);
      setCreatedOrg(org);
      toast({ title: "Workspace created", tone: "success" });
      return true;
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function next() {
    if (step.key === "org") {
      const ok = await createOrg();
      if (!ok) return;
    }
    if (stepIdx < STEPS.length - 1) {
      setStepIdx((i) => i + 1);
    } else {
      setBusy("finish");
      try {
        await refresh();
        onDone();
      } catch (e) {
        toast({ title: friendlyError(e), tone: "danger" });
      } finally {
        setBusy(null);
      }
    }
  }

  async function runOnboarding() {
    streamRef.current?.close();
    setBusy("onboarding");
    setOnboardingError(null);
    try {
      const started = await api.startOnboarding({ name: draft.legalName?.trim() || draft.name?.trim(), country: draft.country });
      setOnboarding(started.onboarding);
      if (started.onboarding.status === "failed") {
        setOnboardingError(started.onboarding.error ?? "eERC onboarding failed.");
        setBusy(null);
        return;
      }
      if (started.onboarding.status === "complete") {
        setBusy(null);
        return;
      }
      streamRef.current = api.subscribeOnboardingStatus(
        (status) => {
          setOnboarding(status);
          if (status.status === "failed") {
            setOnboardingError(status.error ?? "eERC onboarding failed.");
            setBusy(null);
            streamRef.current = null;
          }
          if (status.status === "complete") {
            setBusy(null);
            streamRef.current = null;
          }
        },
        (error) => setOnboardingError(friendlyError(error, "Waiting for eERC onboarding status.")),
      );
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
      setBusy(null);
    }
  }

  async function provisionTreasury() {
    const orgId = createdOrg?.id;
    if (!orgId) {
      setStepIdx(0);
      toast({ title: "Create the workspace before provisioning treasury.", tone: "danger" });
      return;
    }
    setBusy("treasury");
    try {
      const response = await api.provisionTreasury(orgId);
      setTreasury(response);
      toast({
        title: response.registered ? "Your managed treasury is ready" : "Treasury provisioned, registration is still pending",
        tone: response.registered ? "success" : "danger",
      });
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Centered wide>
      <Card className="flex w-[760px] overflow-hidden p-0">
        {/* step rail */}
        <div className="w-[230px] flex-none border-r border-border bg-surface p-5">
          <div className="mb-5 flex items-center gap-2 text-ink"><Logo size={20} /> <span className="font-display">Benzo</span></div>
          <div className="space-y-1">
            {STEPS.map((s, i) => {
              const done = i < stepIdx;
              const cur = i === stepIdx;
              return (
                <div key={s.key} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${cur ? "bg-primary/[0.07] font-semibold text-primary" : done ? "text-ink" : "text-muted"}`}>
                  <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] ${done ? "bg-success/15 text-[#1d7a52]" : cur ? "bg-primary text-white" : "bg-border/60 text-muted"}`}>
                    {done ? <Check size={12} /> : i + 1}
                  </span>
                  {s.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* step content */}
        <div className="flex flex-1 flex-col p-7">
          <motion.div key={step.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }} className="flex-1">
              {step.key === "org" ? (
                <Step title="About your business" hint="The legal entity that will hold the treasury.">
                  <Field label="Business name"><Input value={draft.name ?? ""} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Company name" data-testid="org-name" disabled={!!createdOrg} /></Field>
                  <Field label="Legal name"><Input value={draft.legalName ?? ""} maxLength={80} onChange={(e) => set({ legalName: e.target.value })} placeholder="Legal company name" data-testid="org-legal" disabled={!!createdOrg} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Select label="Country" value={draft.country} onChange={(e) => set({ country: e.target.value })} disabled={!!createdOrg}>
                      <option value="US">United States</option><option value="GB">United Kingdom</option><option value="DE">Germany</option><option value="SG">Singapore</option>
                    </Select>
                    <Select label="Entity type" value={draft.entityType} onChange={(e) => set({ entityType: e.target.value })} disabled={!!createdOrg}>
                      <option>C-Corp</option><option>LLC</option><option>Ltd</option><option>GmbH</option>
                    </Select>
                  </div>
                  <div className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[12px] text-muted">
                    Workspace slug <span className="font-mono font-semibold text-ink" data-testid="org-slug">{slug || "company-name"}</span>
                  </div>
                  {createdOrg ? (
                    <div className="rounded-xl border border-success/25 bg-success/[0.06] p-3.5 text-[13px] font-semibold text-[#1d7a52]">
                      <Check size={15} className="mr-1.5 inline" /> {createdOrg.name} is active for this setup.
                    </div>
                  ) : null}
                </Step>
              ) : step.key === "kyb" ? (
                <Step title="Run eERC onboarding" hint="Benzo approves KYC, allowlists your wallet, drips gas, and waits for eERC registration.">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Registration #"><Input value={draft.registrationNumber ?? ""} onChange={(e) => set({ registrationNumber: e.target.value })} placeholder="Registration number" disabled={busy === "onboarding" || onboardingComplete} /></Field>
                    <Field label="Tax ID (EIN)"><Input value={draft.taxId ?? ""} onChange={(e) => set({ taxId: e.target.value })} placeholder="Tax identifier" disabled={busy === "onboarding" || onboardingComplete} /></Field>
                  </div>
                  <EercOnboarding onboarding={onboarding} busy={busy === "onboarding"} error={onboardingError} onRun={runOnboarding} />
                </Step>
              ) : step.key === "zone" ? (
                <Step title="Where money can move" hint="Pick the regions you operate in. We only let funds move to approved, compliant destinations.">
                  {[{ id: "zone_us", name: "United States", j: "US" }, { id: "zone_eu", name: "European Union", j: "EU" }].map((z) => (
                    <button key={z.id} onClick={() => set({ complianceZoneId: z.id })} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition ${draft.complianceZoneId === z.id ? "border-primary bg-primary/[0.05]" : "border-border hover:bg-[#f4f3ef]"}`}>
                      <span className="font-semibold">{z.name}</span>
                      <span className={`h-4 w-4 rounded-full border-2 ${draft.complianceZoneId === z.id ? "border-primary bg-primary" : "border-border"}`} />
                    </button>
                  ))}
                </Step>
              ) : step.key === "treasury" ? (
                <Step title="Provision your managed treasury" hint="Benzo creates the managed treasury and scoped read material your team uses for reporting and auditor proofs.">
                  {treasury ? (
                    <div className="rounded-xl border border-success/25 bg-success/[0.06] p-4" data-testid="mvk-result">
                      <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1d7a52]"><Check size={16} /> Your managed treasury is ready{treasury.registered ? "" : " · registration pending"}</div>
                      <div className="mt-2 break-all font-mono text-[11px] text-muted">address {treasury.address}</div>
                      {treasury.registrationTxHash ? <div className="mt-1 break-all font-mono text-[11px] text-muted">eERC registration {treasury.registrationTxHash}</div> : null}
                    </div>
                  ) : (
                    <Button loading={busy === "treasury"} onClick={provisionTreasury} data-testid="mvk-register"><ShieldCheck size={16} /> Provision treasury</Button>
                  )}
                </Step>
              ) : (
                <Step title="You're all set" hint="Review and enter your workspace.">
                  <div className="space-y-2 rounded-xl border border-border p-4 text-[13.5px]">
                    <Row k="Business" v={draft.name ?? "Not set"} />
                    <Row k="Legal" v={draft.legalName ?? "Not set"} />
                    <Row k="Country" v={draft.country ?? "Not set"} />
                    <Row k="eERC onboarding" v={onboardingStatusLabel(onboarding)} />
                    <Row k="Compliance" v={draft.complianceZoneId === "zone_eu" ? "European Union" : "United States"} />
                    <Row k="Treasury address" v={treasury?.address ?? "Not set up"} />
                    <Row k="eERC registration tx" v={treasury?.registrationTxHash ?? "Pending"} />
                  </div>
                  <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-border p-3.5 text-[12.5px] text-muted">
                    <Users size={15} className="mt-px flex-none text-primary" />
                    <span>Next, fund your treasury and invite an approver from <b>Settings → Team</b> - maker-checker needs a proposer ≠ approver before your first payout. We'll keep this checklist in your workspace.</span>
                  </div>
                </Step>
              )}
          </motion.div>

          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0} className="text-[13px] font-semibold text-muted disabled:opacity-40">Back</button>
            <Button onClick={next} disabled={!canNext || busy !== null} loading={busy === "org" || busy === "finish"} data-testid={stepIdx === STEPS.length - 1 ? "onboarding-finish" : "wizard-next"}>
              {stepIdx === STEPS.length - 1 ? "Enter workspace" : "Continue"}
            </Button>
          </div>
        </div>
      </Card>
    </Centered>
  );
}

// ----------------------------------------------------------------- eERC onboarding
function EercOnboarding({
  onboarding, busy, error, onRun,
}: {
  onboarding: OnboardingStatus | null;
  busy: boolean;
  error: string | null;
  onRun: () => void;
}) {
  if (!onboarding) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4">
        <div className="flex items-center gap-2 text-[13px] text-muted"><ShieldCheck size={15} className="text-primary" /> Start the eERC setup for your signed-in wallet.</div>
        <Button variant="outline" className="mt-3" loading={busy} onClick={onRun} data-testid="kyb-run"><ScanSearch size={15} /> Run eERC onboarding</Button>
        {error ? <p className="mt-3 text-[12px] text-danger">{error}</p> : null}
      </div>
    );
  }

  const activeIndex = EERC_STEPS.findIndex((s) => !stepDone(onboarding, s.key));
  const done = onboarding.status === "complete";

  return (
    <div className={`rounded-xl border p-4 ${done ? "border-success/25 bg-success/[0.06]" : onboarding.status === "failed" ? "border-danger/30 bg-danger/[0.04]" : "border-border bg-surface"}`} data-testid={done ? "kyb-result" : "kyb-verifying"}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${done ? "bg-success/15 text-[#1d7a52]" : onboarding.status === "failed" ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"}`}>
          {done ? <BadgeCheck size={19} /> : busy ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
        </span>
        <div className="min-w-0 leading-tight">
          <div className={`text-[14px] font-semibold ${done ? "text-[#1d7a52]" : onboarding.status === "failed" ? "text-danger" : "text-ink"}`}>{onboardingStatusLabel(onboarding)}</div>
          <div className="break-all font-mono text-[11px] text-muted">{onboarding.address} · chain {onboarding.chainId}</div>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {EERC_STEPS.map((s, i) => {
          const complete = stepDone(onboarding, s.key);
          const active = !done && onboarding.status !== "failed" && (activeIndex === -1 ? i === EERC_STEPS.length - 1 : i === activeIndex);
          const txHash = stepTx(onboarding, s.key);
          return (
            <div key={s.key} className="flex items-start gap-3">
              <motion.span
                animate={{ scale: complete ? 1 : 0.92 }}
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${complete ? "bg-success/15 text-[#1d7a52]" : active ? "bg-primary/10 text-primary" : "bg-border/50 text-muted"}`}
              >
                {complete ? <Check size={13} /> : active ? <Loader2 size={13} className="animate-spin" /> : <s.icon size={12} />}
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] ${complete ? "text-ink" : active ? "font-medium text-ink" : "text-muted"}`}>{s.label}</div>
                {txHash ? <div className="mt-0.5 break-all font-mono text-[11px] text-muted">tx {txHash}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {error || onboarding.error ? <p className="mt-3 text-[12px] text-danger">{error ?? onboarding.error}</p> : null}
      {done ? <div className="mt-3 text-[11.5px] text-muted">The wallet is approved for eERC private transfers. Treasury provisioning can now register the managed account.</div> : null}
    </div>
  );
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "workspace";
}

function onboardingStatusLabel(onboarding: OnboardingStatus | null): string {
  if (!onboarding) return "Not started";
  return {
    pending_kyc: "KYC pending",
    kyc_approved: "KYC approved",
    allowlisted: "Wallet allowlisted",
    gas_dripped: "Gas dripped",
    awaiting_registration: "Awaiting registration",
    complete: "Complete",
    failed: "Failed",
  }[onboarding.status];
}

function stepDone(onboarding: OnboardingStatus, key: (typeof EERC_STEPS)[number]["key"]): boolean {
  return !!onboarding.steps[key].completedAt;
}

function stepTx(onboarding: OnboardingStatus, key: (typeof EERC_STEPS)[number]["key"]): string | null {
  return key === "allowlist" || key === "gas" ? onboarding.steps[key].txHash : null;
}

function Step({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-xl">{title}</h2>
      <p className="mt-1 text-[13px] text-muted">{hint}</p>
      <div className="mt-5 space-y-3">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="flex-none text-muted">{k}</span><span className="min-w-0 truncate font-semibold text-ink" title={v}>{v}</span></div>;
}
function Centered({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[var(--color-canvas-outer)] p-6" data-testid="console-onboarding">
      {/* looping video stage behind the sign-in card (matches the authenticated Shell) */}
      <StageVideo />
      <div className={`pointer-events-none absolute inset-0 ${wide ? "" : ""} bg-[radial-gradient(50%_40%_at_50%_0%,rgba(115,66,226,0.08),transparent)]`} />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="relative z-10">
        {children}
      </motion.div>
    </div>
  );
}
