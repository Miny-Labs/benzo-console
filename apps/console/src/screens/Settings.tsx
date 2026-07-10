/**
 * Settings & team - the workspace's control surface. Members + team invites,
 * the approval-policy control (require N approvals over $X, the simplified
 * successor to the standalone M-of-N builder), account recovery, roles at a
 * glance (full matrix on demand), counterparties, and integrations. The heavy
 * value-moving actions still live on their own screens.
 */
import { Fragment, useEffect, useState } from "react";
import { Building2, Check, ChevronDown, KeyRound, Minus, Plug, Plus, Send, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import type { Integration } from "@benzo/types";
import { api, type OrgInvite, type RecoveryStatus } from "../lib/api";
import { useConsole } from "../lib/store";
import { ROLES, roleHas, PERMISSION_GROUPS, ROLE_BLURB } from "../lib/permissions";
import { friendlyError, fmtUsd, initials, minorToUsdc, usdcToMinor } from "../lib/format";
import { Screen, Stagger, motion } from "../ui/motion";
import { Button, Card, CopyButton, Input, Modal, Pill, Select, Skeleton, StatusPill, useToast } from "../ui/primitives";

const MEMBER_ROLES = ["owner", "admin", "treasurer", "approver", "auditor"] as const;

export function SettingsScreen() {
  const { counterparties, session, loading } = useConsole();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStatus["recovery"] | null>(null);
  useEffect(() => {
    api.integrations().then(setIntegrations).catch(() => setIntegrations([]));
    api.recoveryStatus().then((r) => setRecovery(r.recovery)).catch(() => setRecovery(null));
  }, []);

  return (
    <Screen>
      <div className="mb-5">
        <h1 className="font-display text-2xl">Settings & team</h1>
        <p className="mt-1 text-[13.5px] text-muted">{session?.org.legalName ?? session?.org.name} · {session?.org.country ?? "Country not set"} · KYB {session?.org.kybStatus}</p>
      </div>

      <Stagger className="space-y-4">
        <Stagger.Item index={0}>
          <TeamCard />
        </Stagger.Item>

        <Stagger.Item index={1}>
          <ApprovalPolicyCard />
        </Stagger.Item>

        <Stagger.Item index={2}>
          <Card className="p-0" data-testid="account-recovery-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-[13px] font-semibold">
              <KeyRound size={15} /> Account recovery
            </div>
            <div className="px-5 py-4 text-[13px] text-muted">
              <div className="font-medium text-ink" data-testid="console-recovery-status">
                {recovery?.bound ? "This workspace is bound to your current sign-in." : "This workspace is not bound yet."}
              </div>
              <p className="mt-1.5 leading-relaxed">
                If your wallet sign-in changes, Benzo blocks access instead of attaching this workspace to a different key. Recovery requires an owner-approved migration.
              </p>
              <ul className="mt-3 space-y-1.5" data-testid="console-recovery-plan">
                {(recovery?.nextSteps?.length ? recovery.nextSteps : ["Finish sign-in as an owner to bind this workspace key."]).map((step) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-primary" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </Stagger.Item>

        <Stagger.Item index={3}>
          <RolesCard />
        </Stagger.Item>

        <Stagger.Item index={4}>
          <Card className="p-0">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-[13px] font-semibold">
              <Building2 size={15} /> Vendors & contractors
            </div>
            <div className="divide-y divide-border">
              {loading && counterparties.length === 0 ? (
                [0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-36" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                ))
              ) : counterparties.length === 0 ? (
                <div className="px-5 py-4 text-[13px] text-muted">No vendors or contractors yet.</div>
              ) : (
                counterparties.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.name}</div>
                      <div className="text-[12px] capitalize text-muted">{c.type}</div>
                    </div>
                    <StatusPill status={c.status} />
                  </div>
                ))
              )}
            </div>
          </Card>
        </Stagger.Item>

        <Stagger.Item index={5}>
          <Card className="p-0">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-[13px] font-semibold">
              <Plug size={15} /> Integrations
            </div>
            <div className="divide-y divide-border">
              {integrations === null ? (
                [0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <Skeleton className="h-3.5 w-28 flex-1" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                ))
              ) : integrations.length === 0 ? (
                <div className="px-5 py-4 text-[13px] text-muted">No integrations connected.</div>
              ) : (
                integrations.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
                    <div className="min-w-0 flex-1 truncate capitalize">{it.provider}</div>
                    <StatusPill status={it.status} />
                  </div>
                ))
              )}
            </div>
          </Card>
        </Stagger.Item>
      </Stagger>
    </Screen>
  );
}

/**
 * Team - members plus team invites (folded in from the retired standalone
 * Invites screen). A team invite mints a console seat; share the link and the
 * teammate finishes sign-in themselves.
 */
function TeamCard() {
  const { members, loading } = useConsole();
  const toast = useToast();
  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("approver");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<OrgInvite | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = () => api.invites().then((all) => setInvites(all.filter((i) => i.kind === "member"))).catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  const pending = invites?.filter((i) => i.status === "sent") ?? [];

  function validate(): string | null {
    if (!email.trim()) return "Enter the teammate's email before creating an invite.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
    if (!role.trim()) return "Choose a role for this teammate.";
    return null;
  }

  async function create() {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      const created = await api.createInvite({ kind: "member", name: name || undefined, email: email || undefined, role });
      setInvites((prev) => [created, ...(prev ?? []).filter((i) => i.id !== created.id)]);
      setName("");
      setEmail("");
      setRole("approver");
      setOpen(false);
      toast({ title: "Invite link created", tone: "success" });
      await load();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(true);
    try {
      await api.revokeInvite(id);
      setConfirmRevoke(null);
      await load();
      toast({ title: "Invite revoked", tone: "muted" });
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card className="p-0" data-testid="team-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Users size={15} /> Team
        </div>
        <Button size="sm" variant="outline" onClick={() => { setFormError(null); setOpen(true); }} data-testid="team-invite-open">
          <UserPlus size={14} /> Invite teammate
        </Button>
      </div>
      <div className="divide-y divide-border">
        {loading && members.length === 0 ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton className="h-8 w-8 flex-none rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))
        ) : members.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-muted">No team members yet. Invite one to enable maker-checker.</div>
        ) : (
          members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
                {initials(m.name ?? m.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.name ?? m.email}</div>
                <div className="truncate text-[12px] text-muted">{m.email}</div>
              </div>
              <Pill tone="primary">{m.role}</Pill>
              <StatusPill status={m.status} />
            </div>
          ))
        )}
      </div>

      {pending.length ? (
        <div className="border-t border-border">
          <div className="px-5 pb-1 pt-3.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted">Pending invites</div>
          <div className="divide-y divide-border">
            {pending.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-5 py-3 text-[13px]" data-testid="team-invite-row">
                <span className="w-36 truncate font-medium text-ink">{inv.name ?? inv.email ?? "Invite"}</span>
                <code className="flex-1 truncate rounded bg-[#f4f3ef] px-2 py-1 text-[11.5px] text-muted">{inv.link}</code>
                {inv.role ? <Pill tone="primary">{inv.role}</Pill> : null}
                <Pill tone="muted">{inv.status}</Pill>
                <CopyButton value={inv.link} />
                <button
                  onClick={() => setConfirmRevoke(inv)}
                  className="rounded p-0.5 text-muted outline-none transition hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label="Revoke invite"
                  data-testid="team-invite-revoke"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invite a teammate"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={create} data-testid="team-invite-create">
              <Send size={15} /> Create invite link
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" data-testid="team-invite-name" />
          <Input label="Email" value={email} onChange={(e) => { setEmail(e.target.value); setFormError(null); }} placeholder="name@company.com" data-testid="team-invite-email" />
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} data-testid="team-invite-role">
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
            ))}
          </Select>
          {formError ? <p className="text-[13px] font-medium text-danger" data-testid="team-invite-error">{formError}</p> : null}
          <p className="text-[12px] text-muted">Team invites create a console seat. Share the link - they finish sign-in themselves.</p>
        </div>
      </Modal>

      <Modal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        title="Revoke this invite link"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button variant="danger" loading={revoking} onClick={() => confirmRevoke && revoke(confirmRevoke.id)} data-testid="team-invite-revoke-confirm">
              <X size={15} /> Revoke link
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          The link for <b>{confirmRevoke?.name ?? confirmRevoke?.email ?? "this invite"}</b> will stop working immediately. Anyone who hasn't accepted it yet won't be able to onboard. You can always create a new link.
        </p>
      </Modal>
    </Card>
  );
}

/**
 * Approval policy - the simplified successor to the standalone M-of-N builder:
 * one honest control, "require N approvals over $X". It edits the workspace's
 * primary policy (amount routing condition + the on-chain-enforced release gate)
 * without exposing the full chain editor, which was too heavy for the surface.
 */
function ApprovalPolicyCard() {
  const { policies, refresh } = useConsole();
  const toast = useToast();
  const policy = policies[0];
  const savedAmountCond = policy?.conditions.find((c) => c.field === "amount");
  const savedAmount = savedAmountCond ? minorToUsdc(savedAmountCond.value) : "";
  const savedN = policy?.releaseGate?.minApprovers ?? policy?.steps[0]?.minApprovers ?? 1;

  const [amount, setAmount] = useState(savedAmount);
  const [n, setN] = useState(savedN);
  const [busy, setBusy] = useState(false);

  // Re-sync from the store only when the underlying policy actually changes
  // (e.g. after a save + refresh), not on every background array-identity churn.
  const sig = policy ? JSON.stringify([policy.conditions, policy.steps, policy.releaseGate]) : "none";
  useEffect(() => {
    setAmount(savedAmount);
    setN(savedN);
    // Keyed on `sig` so edits survive background refreshes; savedAmount/savedN track it.
  }, [sig]);

  const dirty = !!policy && (amount !== savedAmount || n !== savedN);
  // A blank field would otherwise save as $0 — i.e. require approval on EVERY
  // payment — silently. Require an explicit non-negative number to save.
  const amountValid = amount.trim() !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0;

  async function save() {
    if (!policy) return;
    setBusy(true);
    try {
      const minor = usdcToMinor(amount || "0");
      const hasAmount = policy.conditions.some((c) => c.field === "amount");
      const conditions = hasAmount
        ? policy.conditions.map((c) => (c.field === "amount" ? { ...c, operator: "gte" as const, value: minor } : c))
        : [{ field: "amount" as const, operator: "gte" as const, value: minor }, ...policy.conditions];
      const releaseGate = policy.releaseGate ? { ...policy.releaseGate, minApprovers: n } : undefined;
      const steps = releaseGate ? policy.steps : policy.steps.map((s, i) => (i === 0 ? { ...s, minApprovers: n } : s));
      await api.updatePolicy(policy.id, { conditions, steps, releaseGate });
      await refresh();
      toast({ title: "Approval policy saved", tone: "success" });
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-0" data-testid="approval-policy-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-[13px] font-semibold">
        <ShieldCheck size={15} /> Approval policy
      </div>
      {!policy ? (
        <div className="px-5 py-4 text-[13px] text-muted" data-testid="approval-policy-empty">No approval policy yet. One is created with your workspace.</div>
      ) : (
        <>
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-end">
            <div className="w-full sm:w-52">
              <Input
                label="Require approval over (USDC)"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                data-testid="approval-policy-amount"
              />
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-fg">Approvals required</div>
              <Stepper value={n} onDec={() => setN((v) => Math.max(1, v - 1))} onInc={() => setN((v) => v + 1)} testid="approval-policy-approvers" />
            </div>
          </div>
          <div className="px-5 pb-1 text-[13px] text-muted" data-testid="approval-policy-summary">
            Payments over <b className="text-fg">{fmtUsd(usdcToMinor(amount || "0"))}</b> need <b className="text-fg">{n}</b> approval{n === 1 ? "" : "s"} before release.
          </div>
          <div className="mx-5 my-4 flex items-start gap-2 rounded-xl bg-primary/[0.06] px-3.5 py-3 text-[12.5px] text-fg" data-testid="approval-policy-enforcement">
            <ShieldCheck size={15} className="mt-0.5 flex-none text-primary" />
            <span>
              <b>Enforced on-chain.</b> Org funds settle only with a valid in-circuit M-of-N proof - the verifier rejects a single-key spend, so release is gated by the contract, not just this server. A proposer can never approve their own payment.
            </span>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button onClick={save} loading={busy} disabled={!dirty || !amountValid} data-testid="approval-policy-save">
              <Check size={14} /> Save policy
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function Stepper({ value, onDec, onInc, testid }: { value: number; onDec: () => void; onInc: () => void; testid: string }) {
  return (
    <div className="flex items-center gap-3" data-testid={testid}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={onDec}
        aria-label="Fewer approvals"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted outline-none transition hover:bg-canvas focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Minus size={15} />
      </motion.button>
      <span className="w-5 text-center text-[15px] font-semibold" data-testid={`${testid}-value`}>{value}</span>
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={onInc}
        aria-label="More approvals"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted outline-none transition hover:bg-canvas focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Plus size={15} />
      </motion.button>
    </div>
  );
}

/**
 * Roles - the per-role blurb list is the everyday read; the full
 * roles x permissions matrix (driven by ROLE_PERMISSIONS) stays one click away
 * behind "See full matrix" so the surface isn't a wall of checkmarks.
 */
function RolesCard() {
  const [showMatrix, setShowMatrix] = useState(false);
  return (
    <Card className="p-0" data-testid="roles-matrix">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-[13px] font-semibold">
        <ShieldCheck size={15} /> Roles & permissions
      </div>
      <div className="divide-y divide-border">
        {ROLES.map((r) => (
          <div key={r} className="flex items-center gap-3 px-5 py-3 text-[13.5px]" data-testid={`role-blurb-${r}`}>
            <span className="w-24 flex-none font-semibold capitalize text-ink">{r}</span>
            <span className="text-muted">{ROLE_BLURB[r]}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-5 py-3">
        <button
          onClick={() => setShowMatrix((v) => !v)}
          aria-expanded={showMatrix}
          data-testid="roles-matrix-toggle"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ChevronDown size={14} className={`transition ${showMatrix ? "rotate-180" : ""}`} /> {showMatrix ? "Hide full matrix" : "See full matrix"}
        </button>
      </div>
      {showMatrix ? (
        <div className="overflow-x-auto border-t border-border" data-testid="roles-full-matrix">
          <table className="w-full min-w-[660px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-3 font-medium text-muted">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-3 text-center font-semibold capitalize">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <Fragment key={g.group}>
                  <tr>
                    <td colSpan={ROLES.length + 1} className="bg-canvas px-5 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted">{g.group}</td>
                  </tr>
                  {g.items.map((item) => (
                    <tr key={item.key} className="border-b border-border/60">
                      <td className="px-5 py-2.5">{item.label}</td>
                      {ROLES.map((r) => (
                        <td key={r} className="px-3 py-2.5 text-center" data-testid={`perm-${r}-${item.key}`}>
                          {roleHas(r, item.key) ? <Check size={15} className="mx-auto text-success" /> : <Minus size={14} className="mx-auto text-border" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 border-t border-border px-5 py-3 text-[12px] text-muted">
        <ShieldCheck size={13} className="text-primary" /> Auditor is a scoped viewing-key holder - read-only, never a signer. A privacy-native role.
      </div>
    </Card>
  );
}
