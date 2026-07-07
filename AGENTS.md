# benzo-console — agent guide

The **Benzo business console**: the operator app for organizations. Owners/admins
provision a managed treasury, run **private payroll** (CSV → sequential eERC
transfers), manage members and org settings, and — for auditors — decrypt the
compliance ledger. It's the counterpart to the consumer wallet.

Frontend only. Backend + contracts + infra live in
[`Miny-Labs/benzo`](https://github.com/Miny-Labs/benzo). No backend code here.

## Stack (pinned)
- **Vite + React 19 + TypeScript**, **Tailwind CSS v4**.
- **wagmi v2 + viem v2** (SIWE sign-in; the treasury itself is server-custodied).
- Chain defs + addresses from **`@benzo/config`** (vendor with a
  `TODO(@benzo/config)` until it's published).
- Node ≥ 22, pnpm, Biome.

## Backend it talks to (benzo `services/api`)
- **SIWE auth** + **org/tenant model**: orgs, members (owner/operator/viewer),
  managed treasury provisioning (generated EOA sealed server-side, explicit
  consent).
- **Payroll**: CSV intake + validation/preview, run lifecycle (ready → running →
  paused/confirmed), per-item status, SSE progress stream.
- **Auditor**: decrypt compliance events, aggregate report totals, key rotation.
- **Network admin**: allowlist/drip surfaces (BenzoNet precompiles).
- API base URL env-driven (`VITE_API_BASE_URL`); consumes the same SIWE session.

## Brand (from benzo-landing)
- Ethos: **discreet · warm · dependable — privacy is calm, not loud.**
- Violet **#7342E2**, paper **#F2F2EE**, ink **#212C39**, dark panel "the vault"
  **#161E2D**, success green **#38AA75**. Font **Hanken Grotesk**. Benzo mark.
- The console leans "business face" — the dark vault surface, dependable and
  quiet (mirrors the landing's business-side card).

## Pipeline (same as benzo)
- One issue per PR. Codex builds; a human runs the gates, commits (Codex can't
  write `.git` — end with the commit msg + `git add` list), opens the PR, triages
  Greptile/CodeRabbit, merges on green.
- Verify: `pnpm build`, `pnpm lint`, `pnpm test`, Playwright smoke where UI
  matters. **UI issues MUST commit screenshots** (1440×900 + 390×844) to
  `.github/pr-assets/issue-N/`.
- Never commit `.env`, secrets, or generated proving artifacts.
