import "./polyfills";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { RootGate } from "./app/RootGate";
import { ConsoleProvider } from "./lib/store";
import { queryClient, wagmiConfig } from "./lib/wagmi";
import { ToastProvider } from "./ui/primitives";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <MotionConfig reducedMotion="user">
            <BrowserRouter>
              <ConsoleProvider>
                <ToastProvider>
                  <RootGate />
                </ToastProvider>
              </ConsoleProvider>
            </BrowserRouter>
          </MotionConfig>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  );
}
