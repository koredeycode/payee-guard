import { decodeEventLog, type AbiEvent, type Hex } from "viem";
import { getLogsChunked, MAX_LOG_RANGE } from "../packages/aevum/src/index.ts";
import { paymentRejectedEvent, paymentSentEvent } from "./abi.ts";
import { connect, dryRun, env, explorerUrl, printTable, requiredAddress, shortHash } from "./shared.ts";

interface Row {
  block: string;
  tx: string;
  event: string;
  agentId: string;
  payee: string;
  amount: string;
  intentId: string;
  reason: string;
  explorer: string;
}

function bigintArg(value: unknown): string {
  return value === undefined || value === null ? "-" : String(value);
}

function addressArg(value: unknown): string {
  return typeof value === "string" ? shortHash(value) : "-";
}

export async function runReadEvents(): Promise<void> {
  const guard = requiredAddress("GUARD_ADDRESS");
  const fromBlock = BigInt(env("FROM_BLOCK") ?? env("DEPLOY_BLOCK") ?? "0");
  const toBlock = env("TO_BLOCK") ? BigInt(env("TO_BLOCK")!) : undefined;
  const step = BigInt(env("LOG_STEP") ?? MAX_LOG_RANGE.toString());
  if (step < 1n || step > MAX_LOG_RANGE) throw new Error(`LOG_STEP must be 1..${MAX_LOG_RANGE}.`);

  const ctx = await connect();
  if (dryRun()) {
    console.log(`DRY_RUN: would scan guard ${guard} from block ${fromBlock} to ${toBlock ?? "latest"} in ${step}-block chunks on chain ${ctx.chain.id}.`);
    return;
  }

  const rows: Row[] = [];
  for (const [name, event] of [
    ["PaymentSent", paymentSentEvent],
    ["PaymentRejected", paymentRejectedEvent],
  ] as const) {
    const logs = await getLogsChunked(ctx.client, {
      address: guard,
      event: event as AbiEvent,
      fromBlock,
      toBlock,
      step,
      onProgress: (done, total) => {
        if (total > 0n && done % (step * 10n) === 0n) console.error(`  scanned ${done}/${total} blocks`);
      },
    });
    for (const log of logs) {
      const decoded = decodeEventLog({ abi: [event as AbiEvent], data: log.data, topics: log.topics });
      const args = decoded.args as Record<string, unknown>;
      const hash = (log.transactionHash ?? "0x") as Hex;
      rows.push({
        block: (log.blockNumber ?? 0n).toString(),
        tx: shortHash(hash),
        event: name,
        agentId: bigintArg(args.agentId),
        payee: addressArg(args.payee),
        amount: bigintArg(args.amount),
        intentId: addressArg(args.intentId),
        reason: name === "PaymentRejected" ? String(args.reason ?? "") : "accepted",
        explorer: explorerUrl(hash, ctx.mode, ctx.rpcUrl),
      });
    }
  }

  rows.sort((a, b) => (BigInt(a.block) < BigInt(b.block) ? -1 : BigInt(a.block) > BigInt(b.block) ? 1 : 0));
  printTable(["block", "tx", "event", "agentId", "payee", "amount", "intent", "reason", "explorer"], rows.map((row) => [
    row.block, row.tx, row.event, row.agentId, row.payee, row.amount, row.intentId, row.reason, row.explorer,
  ]));
  console.log(`\n${rows.length} payment logs from guard ${guard} (${ctx.chain.id}); amounts are tUSD8 base units (6 decimals).`);
  console.log("Receipts/logs are PROVISIONAL: inclusion, not finality.");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runReadEvents().catch((error: unknown) => {
    console.error(`read-events: ${(error as Error).message}`);
    process.exit(1);
  });
}
