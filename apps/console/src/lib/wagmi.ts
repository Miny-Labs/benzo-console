import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { BENZO_CHAINS } from "@benzo/config";

export const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: BENZO_CHAINS,
  connectors: [injected()],
  transports: {
    [BENZO_CHAINS[0].id]: http(),
    [BENZO_CHAINS[1].id]: http(),
  },
});
