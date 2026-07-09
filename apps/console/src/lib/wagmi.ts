import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { AVALANCHE_CHAIN_ID, BENZO_CHAINS, BENZONET_CHAIN_ID, FUJI_CHAIN_ID } from "@benzo/config";

export const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: BENZO_CHAINS,
  connectors: [injected()],
  // Key transports by explicit chain-ID constants (not positional BENZO_CHAINS
  // indices) so a future array reorder can't silently wire the wrong transport.
  transports: {
    [FUJI_CHAIN_ID]: http(),
    [BENZONET_CHAIN_ID]: http(),
    [AVALANCHE_CHAIN_ID]: http(),
  },
});
