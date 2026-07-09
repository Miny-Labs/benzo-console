import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = env.VITE_API_BASE_URL && /^https?:\/\//.test(env.VITE_API_BASE_URL)
    ? env.VITE_API_BASE_URL
    : "http://localhost:8790";

  return {
    plugins: [react(), tailwindcss()],
    define: { global: "globalThis" },
    resolve: {
      alias: {
        "@benzo/config": r("../../packages/config/src/index.ts"),
        "@benzo/links": r("../../packages/links/src/index.ts"),
        "@benzo/ui/payment-state": r("../../packages/ui/src/payment-state.ts"),
        "@benzo/ui/send-sequence": r("../../packages/ui/src/send-sequence.ts"),
        "@benzo/types": r("../../packages/types/src/index.ts"),
        buffer: "buffer/",
      },
    },
    optimizeDeps: { include: ["buffer"] },
    server: {
      port: 5174,
      proxy: { "/api": { target: apiBaseUrl, changeOrigin: true } },
    },
    test: { environment: "jsdom", globals: true, setupFiles: "./src/test/setup.ts" },
  };
});
