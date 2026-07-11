/**
 * Hierarchical viewing keys (MVK -> TVK) and note discovery encryption.
 *
 * - MVK: master viewing key (an X25519 secret). Its public key feeds the
 *   on-circuit binding tag `tag = Poseidon2(mvk_pub_scalar, blinding)`.
 * - TVK: time/scope-bound key, one-way derived via
 *   HKDF-SHA256(MVK, "benzo/tvk" || scope). The MVK is not recoverable from
 *   any TVK, and TVKs for different scopes are non-correlatable.
 * - Note ciphertexts: X25519 ECDH + AES-256-GCM ("sealed box" style with an
 *   ephemeral sender key). The same plaintext is sealed twice, once to the
 *   recipient's note-discovery key, once to the controlling MVK epoch key -
 *   so the recipient can spend and a scoped auditor can passively decrypt.
 *
 * Viewing keys are decrypt-only. No spend authority is ever derivable here.
 *
 * Runtime: this module is browser-portable, it uses Web Crypto CSPRNG
 * (`./crypto/random`), `@noble/ciphers` AES-256-GCM, and Uint8Array byte
 * helpers (`./crypto/bytes`) instead of `node:crypto`/`Buffer`. The on-wire
 * "BNZ1" box format is byte-identical to the previous node:crypto implementation
 * (standard AES-256-GCM, same HKDF key, same layout), so notes sealed by older
 * builds still decrypt unchanged.
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { x25519 } from "@noble/curves/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "./crypto/random.js";
import { concatBytes, toHex } from "./crypto/bytes.js";
import { FIELD_MODULUS } from "./crypto/poseidon2.js";

export interface ViewingKeypair {
  secret: Uint8Array; // 32 bytes
  publicKey: Uint8Array; // 32 bytes
}

export function generateViewingKeypair(): ViewingKeypair {
  const secret = randomBytes(32);
  return { secret, publicKey: x25519.getPublicKey(secret) };
}

export function viewingKeypairFromSecret(secret: Uint8Array): ViewingKeypair {
  return { secret, publicKey: x25519.getPublicKey(secret) };
}

/** Map an X25519 public key into a BN254 scalar for the in-circuit MVK tag. */
export function viewingPubToScalar(publicKey: Uint8Array): bigint {
  const digest = sha256(publicKey);
  return (BigInt("0x" + toHex(digest)) % FIELD_MODULUS);
}

/**
 * One-way TVK derivation: HKDF-SHA256(MVK_secret, info = "benzo/tvk"||scope).
 * The result is itself an X25519 keypair scoped to e.g. "2026-Q2/corridor=ALL".
 */
export function deriveTvk(mvkSecret: Uint8Array, scope: string): ViewingKeypair {
  const okm = hkdf(sha256, mvkSecret, undefined, `benzo/tvk ${scope}`, 32);
  const secret = new Uint8Array(okm);
  return { secret, publicKey: x25519.getPublicKey(secret) };
}

export interface SealedBox {
  /** ephemeral sender public key (32) || GCM nonce (12) || ciphertext+tag */
  bytes: Uint8Array;
}

// v1 discovery-box format: "BNZ1" (magic) || viewTag(1) || ephPub(32) || nonce(12) || ct.
// The view tag lets a scanner skip the AES-GCM open for non-matching notes after
// the (unavoidable) ECDH, a Zcash/Umbra-style fast path. Boxes without the magic
// prefix are treated as legacy v0 (ephPub||nonce||ct) and always trial-decrypted,
// so previously-emitted notes keep working unchanged.
const MAGIC = Uint8Array.of(0x42, 0x4e, 0x5a, 0x31); // "BNZ1"
const aeadKey = (shared: Uint8Array) => hkdf(sha256, shared, undefined, "benzo/notes/aead", 32);
/** 1-byte view tag derived from the ECDH shared secret. */
export const viewTag = (shared: Uint8Array): number =>
  hkdf(sha256, shared, undefined, "benzo/notes/viewtag", 1)[0];

// Test instrumentation: counts full AES-GCM open attempts (i.e. notes NOT skipped
// by the view-tag fast path). Not used in production paths.
export let _aesOpenAttempts = 0;
export const _resetAesOpenAttempts = () => { _aesOpenAttempts = 0; };

/** Seal plaintext to a recipient X25519 public key (ephemeral-static ECDH, v1 + view tag). */
export function seal(plaintext: Uint8Array, recipientPub: Uint8Array): SealedBox {
  const ephSecret = randomBytes(32);
  const ephPub = x25519.getPublicKey(ephSecret);
  const shared = x25519.getSharedSecret(ephSecret, recipientPub);
  const key = aeadKey(shared);
  const nonce = randomBytes(12);
  // @noble/ciphers AES-256-GCM returns ciphertext || tag(16), byte-identical to
  // node's createCipheriv(update+final)+getAuthTag concatenation.
  const ct = gcm(key, nonce).encrypt(plaintext);
  const tag = Uint8Array.of(viewTag(shared));
  return { bytes: concatBytes(MAGIC, tag, ephPub, nonce, ct) };
}

function hasMagic(box: Uint8Array): boolean {
  return box.length >= 4 && box[0] === MAGIC[0] && box[1] === MAGIC[1] && box[2] === MAGIC[2] && box[3] === MAGIC[3];
}

/** Try to open a sealed box; returns null when the key doesn't fit (AEAD auth fails). */
export function open(box: Uint8Array, secret: Uint8Array): Uint8Array | null {
  try {
    let off = 0;
    let expectTag = -1;
    if (hasMagic(box)) { expectTag = box[4]; off = 5; } // v1: magic + view tag
    const ephPub = box.slice(off, off + 32);
    const shared = x25519.getSharedSecret(secret, ephPub);
    // view-tag fast path: skip the AES-GCM open for non-matching notes (v1 only).
    if (expectTag >= 0 && viewTag(shared) !== expectTag) return null;
    const nonce = box.slice(off + 32, off + 44);
    const body = box.slice(off + 44); // ciphertext || tag(16)
    const key = aeadKey(shared);
    _aesOpenAttempts++;
    // decrypt throws on auth-tag mismatch -> caught below, returns null.
    return gcm(key, nonce).decrypt(body);
  } catch {
    return null;
  }
}

/** Note plaintext layout for discovery ciphertexts. */
export interface NotePlain {
  amount: bigint;
  recipientPk: bigint;
  blinding: bigint;
  assetId: bigint;
  memo?: string;
}

export function encodeNotePlain(n: NotePlain): Uint8Array {
  const json = JSON.stringify({
    amount: n.amount.toString(),
    recipientPk: n.recipientPk.toString(),
    blinding: n.blinding.toString(),
    assetId: n.assetId.toString(),
    memo: n.memo ?? "",
  });
  return new TextEncoder().encode(json);
}

export function decodeNotePlain(bytes: Uint8Array): NotePlain {
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  return {
    amount: BigInt(obj.amount),
    recipientPk: BigInt(obj.recipientPk),
    blinding: BigInt(obj.blinding),
    assetId: BigInt(obj.assetId),
    memo: obj.memo || undefined,
  };
}
