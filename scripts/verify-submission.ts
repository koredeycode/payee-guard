import {
  decodeEventLog,
  isHex,
  toEventSelector,
  type AbiEvent,
  type Log,
  type PublicClient,
} from "viem";
import { aevumTestnet, AEVUM_FORK_CHAIN_ID } from "../packages/aevum/src/index.ts";
import { paymentRejectedEvent, paymentSentEvent } from "./abi.ts";
import { connect, env, printTable, requiredAddress, shortHash, waitForReceipt } from "./shared.ts";
import { readTxTable, type TxEntry } from "./tx-table.ts";

interface Check {
  scenario: string;
  ok: boolean;
  detail: string;
  confirmations: number;
  tx: string;
}

function eventByName(name: string): AbiEvent | undefined {
  if (name === "PaymentSent") return paymentSentEvent;
  if (name === "PaymentRejected") return paymentRejectedEvent;
  return undefined;
}

function equalAddress(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

async function checkEntry(entry: TxEntry, client: PublicClient, guard: string, chainId: number): Promise<Check> {
  if (!isHex(entry.txHash) || entry.txHash.length !== 66) {
    return { scenario: entry.scenario, ok: false, detail: "invalid tx hash", confirmations: 0, tx: String(entry.txHash) };
  }
  const tx = shortHash(entry.txHash);

  let receipt;
  let confirmations = 0;
  try {
    const result = await waitForReceipt(client, entry.txHash, {
      timeoutMs: Number(env("VERIFY_TIMEOUT_MS") ?? "60000"),
    });
    receipt = result.receipt;
    confirmations = result.confirmations;
  } catch (error) {
    return {
      scenario: entry.scenario,
      ok: false,
      detail: `receipt lookup failed: ${(error as Error).message}`,
      confirmations,
      tx,
    };
  }

  const failures: string[] = [];
  if (receipt.status !== "success") failures.push(`status=${receipt.status}`);
  if (!equalAddress(receipt.to ?? undefined, guard)) failures.push(`to=${receipt.to ?? "none"}, expected guard ${guard}`);
  if (entry.block && receipt.blockNumber !== BigInt(entry.block)) {
    failures.push(`block=${receipt.blockNumber}, claimed ${entry.block}`);
  }
  if (entry.chainId !== undefined && entry.chainId !== chainId) {
    failures.push(`claimed chain ${entry.chainId}, actual ${chainId}`);
  }
  if (entry.explorerUrl && !entry.explorerUrl.toLowerCase().includes(entry.txHash.toLowerCase())) {
    failures.push("explorerUrl does not contain the tx hash");
  }

  const event = eventByName(entry.event);
  if (!event) {
    failures.push(`unknown event ${entry.event}`);
  } else {
    const topic = toEventSelector(event).toLowerCase();
    const matching = receipt.logs.filter(
      (log: Log) => equalAddress(log.address, guard) && log.topics[0]?.toLowerCase() === topic,
    );
    if (matching.length === 0) {
      failures.push(`no ${entry.event} log emitted by the guard`);
    } else {
      let decodedArgs: Record<string, unknown> | undefined;
      for (const log of matching) {
        try {
          const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
          decodedArgs = decoded.args as Record<string, unknown>;
          break;
        } catch {
          // Another log with the same topic may decode cleanly.
        }
      }
      if (!decodedArgs) {
        failures.push(`${entry.event} log could not be decoded with the guard ABI`);
      } else {
        const reason = String(decodedArgs.reason ?? "accepted");
        if (entry.reason && reason.toLowerCase() !== entry.reason.toLowerCase()) {
          failures.push(`reason "${reason}" != claimed "${entry.reason}"`);
        }
        if (entry.agentId !== undefined && String(decodedArgs.agentId) !== entry.agentId) {
          failures.push(`agentId=${String(decodedArgs.agentId)}, claimed ${entry.agentId}`);
        }
        if (entry.payee && !equalAddress(String(decodedArgs.payee), entry.payee)) {
          failures.push(`payee=${String(decodedArgs.payee)}, claimed ${entry.payee}`);
        }
        if (entry.amount !== undefined && String(decodedArgs.amount) !== entry.amount) {
          failures.push(`amount=${String(decodedArgs.amount)}, claimed ${entry.amount}`);
        }
        if (entry.intentId && String(decodedArgs.intentId).toLowerCase() !== entry.intentId.toLowerCase()) {
          failures.push("intentId mismatch");
        }
      }
    }
  }

  return {
    scenario: entry.scenario,
    ok: failures.length === 0,
    detail: failures.length ? failures.join("; ") : `receipt ok, ${entry.event} args match`,
    confirmations,
    tx,
  };
}

export async function runVerify(): Promise<void> {
  const table = readTxTable();
  const expected = Number(
    env("EXPECTED_CHAIN_ID") ?? (table.network === "fork" ? AEVUM_FORK_CHAIN_ID : aevumTestnet.id),
  );
  const network = expected === AEVUM_FORK_CHAIN_ID ? "fork" : "live";
  if (expected !== aevumTestnet.id && expected !== AEVUM_FORK_CHAIN_ID) {
    throw new Error("EXPECTED_CHAIN_ID must be 44005 (live) or 440050 (fork).");
  }
  const ctx = await connect({ network });
  const guard = requiredAddress("GUARD_ADDRESS");

  const results: Check[] = [];
  for (const entry of table.entries) results.push(await checkEntry(entry, ctx.client, guard, expected));

  printTable(
    ["scenario", "verdict", "checks", "confirmations (provisional)", "tx"],
    results.map((result) => [
      result.scenario,
      result.ok ? "✓ PASS" : "✗ FAIL",
      result.detail,
      String(result.confirmations),
      result.tx,
    ]),
  );
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} entries verified on chain ${expected}. Receipts are PROVISIONAL, not final.`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runVerify().catch((error: unknown) => {
    console.error(`verify-submission: ${(error as Error).message}`);
    process.exit(1);
  });
}
