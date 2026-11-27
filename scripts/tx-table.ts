import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Address, Hex } from "viem";
import { env } from "./shared.ts";

export const TX_TABLE_PATH = resolve(env("TX_TABLE_PATH") ?? "docs/tx-table.json");

export interface TxEntry {
  /** One of the eight demo scenarios, e.g. "01-legit-within-caps". */
  scenario: string;
  txHash: Hex;
  event: string;
  verdict: "SENT" | "REJECTED" | "INFO";
  reason: string;
  explorerUrl: string;
  /** Decimal block number, as a string so JSON stays lossless. */
  block: string;
  status: "success" | "reverted";
  /** A receipt is inclusion, never finality. */
  finality: "provisional";
  confirmations: number;
  network: "live" | "fork";
  chainId: number;
  agentId?: string;
  payee?: Address;
  amount?: string;
  intentId?: Hex;
}

export interface TxTable {
  _note: string;
  chainId: number;
  network: "live" | "fork";
  generatedAt: string;
  entries: TxEntry[];
}

const NOTE =
  "Provisional receipts from `pnpm demo`. A receipt proves inclusion, not finality; " +
  "confirmations were observed when the table was written. Verify with `pnpm verify:submission`.";

export function readTxTable(path = TX_TABLE_PATH): TxTable {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run pnpm demo first.`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed)) {
    return { _note: NOTE, chainId: 44005, network: "live", generatedAt: "", entries: parsed as TxEntry[] };
  }
  if (parsed && typeof parsed === "object" && "entries" in parsed) {
    const table = parsed as Partial<TxTable>;
    if (!Array.isArray(table.entries)) throw new Error(`${path}: entries must be an array.`);
    return {
      _note: table._note ?? NOTE,
      chainId: table.chainId ?? 44005,
      network: table.network ?? "live",
      generatedAt: table.generatedAt ?? "",
      entries: table.entries,
    };
  }
  throw new Error(`${path}: expected an object with an "entries" array.`);
}

export function writeTxTable(table: TxTable, path = TX_TABLE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const body: TxTable = { ...table, _note: table._note || NOTE };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}
