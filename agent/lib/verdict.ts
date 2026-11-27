import { keccak256, stringToHex, type Hex } from "viem";

/**
 * Shared canonicalization for Payee Guard.
 *
 * Two different questions are answered here on purpose:
 *
 *  1. `nameHash` is the exact, on-chain identity hash: NFKC, trim, UTF-8, keccak256.
 *     It must stay byte-exact, so it does NOT casefold or remove zero-width characters.
 *  2. `canonicalName` / `confusableSkeleton` are for *comparison* only. They remove
 *     the tricks a lookalike name uses (homoglyphs, invisibles, whitespace) without
 *     ever changing what gets hashed or signed.
 */

/** Remove zero-width, bidi, and control characters. Whitespace controls become a space. */
export function stripInvisible(input: string): string {
  return input.replace(/[\p{Cc}\p{Cf}]/gu, (character) => (/\s/u.test(character) ? " " : ""));
}

/**
 * Locale-independent case folding for the few characters where `toLowerCase()`
 * alone is not enough. NFKC runs first, so fullwidth/Kelvin variants arrive here
 * already folded.
 */
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

/**
 * Character map for visually confusable scripts. Latin `i`, `l`, `1`, Cyrillic `і`
 * and Greek `Ι` all fold to `l`; `0`, `O` and Cyrillic/Greek `о` fold to `o`.
 * `rn` -> `m` and `vv` -> `w` are applied after the per-character map.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic homoglyphs
  а: "a", А: "a", б: "b", Б: "b", в: "b", В: "b", г: "r", Г: "r",
  д: "d", Д: "d", е: "e", Е: "e", ё: "e", Ё: "e", ж: "zh", Ж: "zh",
  з: "3", З: "3", и: "n", И: "n", й: "n", Й: "n", к: "k", К: "k",
  л: "l", Л: "l", м: "m", М: "m", н: "h", Н: "h", о: "o", О: "o",
  п: "n", П: "n", р: "p", Р: "p", с: "c", С: "c", т: "t", Т: "t",
  у: "y", У: "y", ф: "f", Ф: "f", х: "x", Х: "x", ц: "u", Ц: "u",
  ч: "4", Ч: "4", ш: "w", Ш: "w", щ: "w", Щ: "w", ъ: "", Ъ: "",
  ы: "y", Ы: "y", ь: "", Ь: "", э: "e", Э: "e", ю: "u", Ю: "u",
  я: "r", Я: "r", і: "l", І: "l", ј: "j", Ј: "j", ѕ: "s", Ѕ: "s",
  є: "e", Є: "e", ґ: "r", Ґ: "r",
  // Greek homoglyphs
  α: "a", Α: "a", β: "b", Β: "b", γ: "y", Γ: "y", δ: "d", Δ: "d",
  ε: "e", Ε: "e", ζ: "z", Ζ: "z", η: "n", Η: "n", θ: "o", Θ: "o",
  ι: "l", Ι: "l", κ: "k", Κ: "k", λ: "l", Λ: "l", μ: "u", Μ: "u",
  ν: "v", Ν: "v", ξ: "e", Ξ: "e", ο: "o", Ο: "o", π: "n", Π: "n",
  ρ: "p", Ρ: "p", σ: "o", Σ: "o", ς: "o", τ: "t", Τ: "t", υ: "u",
  Υ: "u", φ: "f", Φ: "f", χ: "x", Χ: "x", ψ: "y", Ψ: "y", ω: "w",
  Ω: "w",
  // Digits and latin lookalikes
  "0": "o", "1": "l", i: "l", I: "l", l: "l", L: "l", ı: "l", O: "o",
};

/**
 * Lowercase, homoglyph-folded comparison key. Whitespace is dropped so that
 * "AcmeTreasury" and "Acme Treasury" compare equal. Never used for hashing or signing.
 */
export function confusableSkeleton(input: string): string {
  const canonical = canonicalName(input);
  return Array.from(canonical, (character) => CONFUSABLES[character] ?? character)
    .join("")
    .replace(/rn/gu, "m")
    .replace(/vv/gu, "w")
    .replace(/\s+/gu, "");
}

/** Exact identity hash: keccak256(utf8(NFKC(name).trim())). */
export function nameHash(name: string): Hex {
  return keccak256(stringToHex(name.normalize("NFKC").trim()));
}

/** Stable metadata fields; volatile fields such as fetchedAt are deliberately absent. */
export const METADATA_FIELDS = [
  "type",
  "name",
  "active",
  "services",
  "registrations",
] as const;

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

export interface NameDiff {
  exact: boolean;
  skeletonMatch: boolean;
  canonical: string;
  expectedCanonical: string;
  skeleton: string;
  expectedSkeleton: string;
  invisibleCharacters: number;
  differences: string[];
}

/** Explain why a claimed name does (or does not) match a registry name. */
export function diffName(observed: string, expected: string): NameDiff {
  const canonical = canonicalName(observed);
  const expectedCanonical = canonicalName(expected);
  const skeleton = confusableSkeleton(observed);
  const expectedSkeleton = confusableSkeleton(expected);
  const invisibleCharacters = [
    ...(observed.normalize("NFKC").match(/[\p{Cc}\p{Cf}]/gu) ?? []),
  ].length;
  const differences: string[] = [];
  if (canonical !== expectedCanonical) differences.push("canonical name differs");
  if (skeleton !== expectedSkeleton) differences.push("confusable skeleton differs");
  if (invisibleCharacters > 0) differences.push("invisible characters present");
  if (canonical.length !== expectedCanonical.length) differences.push("length differs");
  return {
    exact: canonical === expectedCanonical,
    skeletonMatch: skeleton === expectedSkeleton,
    canonical,
    expectedCanonical,
    skeleton,
    expectedSkeleton,
    invisibleCharacters,
    differences,
  };
}
