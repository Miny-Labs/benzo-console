export interface KVStore {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface WalletSecrets {
  spendKey?: string;
  viewKey?: string;
  address?: string;
  [key: string]: unknown;
}

const DEFAULT_STORE_KEY = "benzo.wallet.secrets";

async function read(kv: KVStore, key: string): Promise<string | null> {
  return kv.getItem(key);
}

async function write(kv: KVStore, key: string, value: string): Promise<void> {
  await kv.setItem(key, value);
}

export class Keychain {
  private locked = false;

  private constructor(private readonly secrets: WalletSecrets) {}

  static async exists(kv: KVStore, storeKey = DEFAULT_STORE_KEY): Promise<boolean> {
    return (await read(kv, storeKey)) !== null;
  }

  static async create(opts: {
    kv: KVStore;
    wrappingKey: Uint8Array;
    secrets: WalletSecrets;
    storeKey?: string;
  }): Promise<Keychain> {
    await write(opts.kv, opts.storeKey ?? DEFAULT_STORE_KEY, JSON.stringify({ secrets: opts.secrets }));
    return new Keychain(opts.secrets);
  }

  static async unlock(opts: {
    kv: KVStore;
    wrappingKey: Uint8Array;
    storeKey?: string;
  }): Promise<Keychain> {
    const raw = await read(opts.kv, opts.storeKey ?? DEFAULT_STORE_KEY);
    if (!raw) throw new Error("wallet not found");
    const parsed = JSON.parse(raw) as { secrets?: WalletSecrets };
    return new Keychain(parsed.secrets ?? {});
  }

  exportSecrets(): WalletSecrets {
    if (this.locked) throw new Error("wallet locked");
    return this.secrets;
  }

  lock(): void {
    this.locked = true;
  }
}
