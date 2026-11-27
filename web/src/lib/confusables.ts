/**
 * Character-level comparison for confirmation of payee.
 * Names are folded to a Latin "skeleton" (homoglyphs, digit lookalikes and invisible controls),
 * then the two skeletons are aligned so the original characters can be compared in place.
 * This is a display and review aid. It never decides a payment on its own.
 */

export type CharKind = "plain" | "homoglyph" | "digit" | "pair" | "hidden";

export interface CharUnit {
  index: number;
  raw: string;
  normal: string;
  kind: CharKind;
  codepoint: string;
  name: string;
}

export type DiffState = "match" | "confusable" | "different";

export interface DiffColumn {
  key: string;
  invoice?: CharUnit;
  registry?: CharUnit;
  invoiceHidden: CharUnit[];
  registryHidden: CharUnit[];
  state: DiffState;
}

export interface NameDiff {
  columns: DiffColumn[];
  invoiceSkeleton: string;
  registrySkeleton: string;
  skeletonMatches: boolean;
  confusableCount: number;
}

/** Cyrillic, Greek and full-width forms that read as Latin letters in ordinary text. */
const homoglyphs: Record<string, { to: string; name: string }> = {
  "а": { to: "a", name: "Cyrillic small letter a" },
  "е": { to: "e", name: "Cyrillic small letter ye" },
  "о": { to: "o", name: "Cyrillic small letter o" },
  "р": { to: "p", name: "Cyrillic small letter pe" },
  "с": { to: "c", name: "Cyrillic small letter es" },
  "х": { to: "x", name: "Cyrillic small letter ha" },
  "у": { to: "y", name: "Cyrillic small letter u" },
  "і": { to: "i", name: "Cyrillic small letter dotted i" },
  "ј": { to: "j", name: "Cyrillic small letter je" },
  "ѕ": { to: "s", name: "Cyrillic small letter dze" },
  "һ": { to: "h", name: "Cyrillic small letter shortened ha" },
  "ԁ": { to: "d", name: "Cyrillic small letter de" },
  "Α": { to: "A", name: "Greek capital alpha" },
  "Β": { to: "B", name: "Greek capital beta" },
  "Ε": { to: "E", name: "Greek capital epsilon" },
  "Ζ": { to: "Z", name: "Greek capital zeta" },
  "Η": { to: "H", name: "Greek capital eta" },
  "Ι": { to: "I", name: "Greek capital iota" },
  "Κ": { to: "K", name: "Greek capital kappa" },
  "Μ": { to: "M", name: "Greek capital mu" },
  "Ν": { to: "N", name: "Greek capital nu" },
  "Ο": { to: "O", name: "Greek capital omicron" },
  "Ρ": { to: "P", name: "Greek capital rho" },
  "Τ": { to: "T", name: "Greek capital tau" },
  "Υ": { to: "Y", name: "Greek capital upsilon" },
  "Χ": { to: "X", name: "Greek capital chi" },
  "α": { to: "a", name: "Greek small alpha" },
  "ε": { to: "e", name: "Greek small epsilon" },
  "ο": { to: "o", name: "Greek small omicron" },
  "ρ": { to: "p", name: "Greek small rho" },
  "κ": { to: "k", name: "Greek small kappa" },
  "ν": { to: "v", name: "Greek small nu" },
  "τ": { to: "t", name: "Greek small tau" },
  "χ": { to: "x", name: "Greek small chi" },
  "ι": { to: "i", name: "Greek small iota" },
};

/** Format characters that change rendering or reading order without adding a visible letter. */
const hiddenControls: Record<string, string> = {
  "\u200B": "Zero-width space",
  "\u200C": "Zero-width non-joiner",
  "\u200D": "Zero-width joiner",
  "\uFEFF": "Zero-width no-break space",
  "\u00AD": "Soft hyphen",
  "\u200E": "Left-to-right mark",
  "\u200F": "Right-to-left mark",
  "\u202A": "Left-to-right embedding",
  "\u202B": "Right-to-left embedding",
  "\u202C": "Pop directional formatting",
  "\u202D": "Left-to-right override",
  "\u202E": "Right-to-left override",
  "\u2066": "Left-to-right isolate",
  "\u2067": "Right-to-left isolate",
  "\u2068": "First strong isolate",
  "\u2069": "Pop directional isolate",
};

function codepointOf(char: string): string {
  const point = char.codePointAt(0);
  return `U+${point === undefined ? "0000" : point.toString(16).toUpperCase().padStart(4, "0")}`;
}

function fullwidthToAscii(char: string): string | undefined {
  const point = char.codePointAt(0);
  if (point === undefined || point < 0xff01 || point > 0xff5e) return undefined;
  return String.fromCharCode(point - 0xfee0);
}

/** Fold one name into comparable units. Hidden controls stay attached to their position. */
export function tokenize(value: string): CharUnit[] {
  const chars = Array.from(value);
  const units: CharUnit[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];

    if (hiddenControls[char]) {
      units.push({
        index: i,
        raw: char,
        normal: "",
        kind: "hidden",
        codepoint: codepointOf(char),
        name: hiddenControls[char],
      });
      continue;
    }

    const fold = homoglyphs[char] ?? (fullwidthToAscii(char) ? { to: fullwidthToAscii(char)!, name: "Full-width form" } : undefined);
    const normal = fold?.to ?? (char === "0" ? "O" : char);
    const kind: CharKind = fold ? "homoglyph" : char === "0" ? "digit" : "plain";

    // "rn" is read as "m" at small sizes. Fold the pair as one unit so both names align.
    if (normal.toLowerCase() === "r") {
      const nextNormal = (homoglyphs[chars[i + 1]]?.to ?? fullwidthToAscii(chars[i + 1] ?? "") ?? chars[i + 1] ?? "").toLowerCase();
      if (nextNormal === "n") {
        const nextChar = chars[i + 1];
        units.push({
          index: i,
          raw: char + nextChar,
          normal: normal === "R" ? "M" : "m",
          kind: "pair",
          codepoint: `${codepointOf(char)} ${codepointOf(nextChar)}`,
          name: "Two letters read as one",
        });
        i += 1;
        continue;
      }
    }

    units.push({
      index: i,
      raw: char,
      normal,
      kind,
      codepoint: codepointOf(char),
      name: fold?.name ?? (char === "0" ? "Digit zero" : "Latin letter"),
    });
  }
  return units;
}

/** The normalized Latin skeleton of a name, with invisible controls removed. */
export function skeleton(value: string): string {
  return tokenize(value)
    .map((unit) => unit.normal)
    .join("");
}

type Pair = [CharUnit | null, CharUnit | null];

/** Longest-common-subsequence alignment over normalized characters. Names here are short. */
function align(a: CharUnit[], b: CharUnit[]): Pair[] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i].normal === b[j].normal ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].normal === b[j].normal) {
      pairs.push([a[i], b[j]]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pairs.push([a[i], null]);
      i += 1;
    } else {
      pairs.push([null, b[j]]);
      j += 1;
    }
  }
  while (i < a.length) pairs.push([a[i++], null]);
  while (j < b.length) pairs.push([null, b[j++]]);
  return pairs;
}

function hiddenBetween(units: CharUnit[], before: number, after: number): CharUnit[] {
  return units.filter((unit) => unit.kind === "hidden" && unit.index > before && unit.index < after);
}

function stateOf(a: CharUnit | null, b: CharUnit | null): DiffState {
  if (!a || !b) return "different";
  if (a.normal !== b.normal) return "different";
  return a.kind === "plain" && b.kind === "plain" ? "match" : "confusable";
}

export function compareNames(invoice: string, registry: string): NameDiff {
  const invoiceUnits = tokenize(invoice);
  const registryUnits = tokenize(registry);
  const invoiceVisible = invoiceUnits.filter((unit) => unit.kind !== "hidden");
  const registryVisible = registryUnits.filter((unit) => unit.kind !== "hidden");
  let lastInvoice = -1;
  let lastRegistry = -1;

  const columns: DiffColumn[] = align(invoiceVisible, registryVisible).map(([inv, reg], position) => {
    const invoiceHidden = hiddenBetween(invoiceUnits, lastInvoice, inv?.index ?? invoice.length);
    const registryHidden = hiddenBetween(registryUnits, lastRegistry, reg?.index ?? registry.length);
    if (inv) lastInvoice = inv.index + (inv.kind === "pair" ? 1 : 0);
    if (reg) lastRegistry = reg.index + (reg.kind === "pair" ? 1 : 0);
    return {
      key: `col-${position}`,
      invoice: inv ?? undefined,
      registry: reg ?? undefined,
      invoiceHidden,
      registryHidden,
      state: stateOf(inv, reg),
    };
  });

  const invoiceSkeleton = skeleton(invoice);
  const registrySkeleton = skeleton(registry);
  return {
    columns,
    invoiceSkeleton,
    registrySkeleton,
    skeletonMatches: invoiceSkeleton === registrySkeleton,
    confusableCount: columns.filter((column) => column.state !== "match").length + columns.reduce((sum, column) => sum + column.invoiceHidden.length + column.registryHidden.length, 0),
  };
}

/** Accessible description of a character, including its code point when it is confusable. */
export function describeUnit(unit: CharUnit, side: "Invoice" | "Registry"): string {
  if (unit.kind === "hidden") return `${side}: ${unit.name} (${unit.codepoint}), invisible in the name`;
  if (unit.kind === "pair") return `${side}: ${unit.raw} reads as ${unit.normal}. Two characters that look like one letter`;
  if (unit.kind === "homoglyph") return `${side}: ${unit.name} (${unit.codepoint}) reads as ${unit.normal}`;
  if (unit.kind === "digit") return `${side}: digit zero reads as capital O`;
  return `${side}: ${unit.raw}`;
}

export const confusableReference = [
  { sample: "rn", normal: "m", note: "Two letters read as one" },
  { sample: "0", normal: "O", note: "Digit for letter" },
  { sample: "о", normal: "o", note: "Cyrillic for Latin" },
  { sample: "ο", normal: "o", note: "Greek for Latin" },
  { sample: "\u200B", normal: "removed", note: "Zero-width space" },
  { sample: "\u202E", normal: "removed", note: "Bidi override" },
] as const;
