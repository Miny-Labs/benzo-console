export enum AssuranceTier {
  BASIC = 1,
  VERIFIED_ID = 2,
  BUSINESS = 3,
}

export interface IssueCredentialInput {
  holderBinding: bigint;
  tier: AssuranceTier;
  expiry: bigint;
  serial: bigint;
}

export interface IssuedCredential {
  issuerKeyId: bigint;
  issuerAx: bigint;
  issuerAy: bigint;
  sigS: bigint;
  sigR8x: bigint;
  sigR8y: bigint;
  credType: bigint;
  attrHash: bigint;
  expiry: bigint;
  serial: bigint;
}

function foldHexSeed(seed: string): bigint {
  const hex = seed.replace(/^0x/, "") || "0";
  return BigInt(`0x${hex.slice(0, 64)}`);
}

function mix(...values: bigint[]): bigint {
  return values.reduce((acc, value) => ((acc ^ value) * 0x100000001b3n) & ((1n << 253n) - 1n), 0xcbf29ce484222325n);
}

export class CredentialIssuer {
  private constructor(private readonly seed: bigint) {}

  static async create(seed: string): Promise<CredentialIssuer> {
    return new CredentialIssuer(foldHexSeed(seed));
  }

  issue(input: IssueCredentialInput): IssuedCredential {
    const credType = BigInt(input.tier);
    const attrHash = mix(input.holderBinding, credType, input.expiry, input.serial);
    const issuerKeyId = mix(this.seed, 1n);
    return {
      issuerKeyId,
      issuerAx: mix(this.seed, 2n),
      issuerAy: mix(this.seed, 3n),
      sigS: mix(attrHash, this.seed, 4n),
      sigR8x: mix(attrHash, this.seed, 5n),
      sigR8y: mix(attrHash, this.seed, 6n),
      credType,
      attrHash,
      expiry: input.expiry,
      serial: input.serial,
    };
  }
}
