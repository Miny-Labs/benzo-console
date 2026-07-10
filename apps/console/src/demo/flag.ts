/**
 * Demo-mode flag. Build-time constant: `VITE_DEMO_MODE=1 pnpm build` flips the
 * console into a login-free, no-backend showcase (seeded org, mocked api, playable
 * cinematics).
 *
 * The access MUST be the direct `import.meta.env.VITE_DEMO_MODE` member expression
 * (no intermediate variable) so Vite statically replaces it at build time: unset,
 * it folds to `false`, letting the whole demo graph (demoApi + seed) tree-shake
 * out of a normal build so production output is unchanged. `VITE_*` keys are typed
 * `any` via vite/client's ImportMetaEnv index signature, so no cast is needed.
 */
export const DEMO_MODE: boolean = import.meta.env.VITE_DEMO_MODE === "1";
