import { keccak256, stringToHex, type Hex } from "viem";

/**
 * Client-side copies of the canonicalization in agent/lib/verdict.ts. They must stay
 * byte-identical to the agent: the console shows the same hashes the contract stores
 * and the agent verifies. Do not add casefolding, invisible stripping or sorting here.
 */

/** Remove zero-width, bidi, and control characters. Whitespace controls become a space. */
export function stripInvisible(input: string): string {
  return input.replace(/[\p{Cc}\p{Cf}]/gu, (character) => (/\s/u.test(character) ? " " : ""));
}

/** Locale-independent case folding for the few characters where `toLowerCase()` alone is not enough. */
export function casefold(input: string): string {
  return input
    .replace(/ß/gu, "ss")
    .replace(/ẞ/gu, "ss")
    .replace(/ς/gu, "σ")
    .replace(/ſ/gu, "s")
    .replace(/İ/gu, "i\u0307")
    .toLowerCase();
}

/** NFKC + invisible stripping + casefold + whitespace collapse + trim. */
export function canonicalName(input: string): string {
  return casefold(stripInvisible(input.normalize("NFKC")))
    .replace(/\s+/gu, " ")
    .trim();
}

/** Exact identity hash: keccak256(utf8(NFKC(name).trim())). */
export function nameHash(name: string): Hex {
  return keccak256(stringToHex(name.normalize("NFKC").trim()));
}

/** Stable metadata fields; volatile fields such as fetchedAt are deliberately absent. */
export const METADATA_FIELDS = ["type", "name", "active", "services", "registrations"] as const;

export type MetadataRecord = Record<string, unknown>;

/** Recursively sort object keys and drop undefined values (JSON-compatible only). */
export function canonicalJson(value: unknown): string {
  const sorted = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sorted);
    if (node !== null && typeof node === "object") {
      const result: Record<string, unknown> = {};
      const entries = Object.entries(node as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      for (const [key, item] of entries) result[key] = sorted(item);
      return result;
    }
    return node;
  };
  return JSON.stringify(sorted(value));
}

/** Keep only stable fields, so a refreshed fetch timestamp cannot change the hash. */
export function stableMetadata(metadata: MetadataRecord): MetadataRecord {
  const stable: MetadataRecord = {};
  for (const field of METADATA_FIELDS) {
    if (metadata[field] !== undefined) stable[field] = metadata[field];
  }
  return stable;
}

/** keccak256 of the canonical JSON of the stable metadata fields. */
export function metadataHash(metadata: MetadataRecord): Hex {
  return keccak256(stringToHex(canonicalJson(stableMetadata(metadata))));
}
