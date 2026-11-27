#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./lib/config.js";
import { readFixture, type RawPaymentRequest } from "./lib/demo-data.js";
import { extractPaymentRequest } from "./lib/llm.js";
import { createPaymentTools, type PaymentTools } from "./lib/tools.js";

/**
 * Deterministic worker: the LLM proposes fields, policy disposes.
 *
 * If resolution says NAME_SPOOF / UNKNOWN / INACTIVE, or the contract says
 * NOT_ALLOWLISTED, the flow stops. There is deliberately no fallback that tries
 * another address — that is the attack this worker exists to prevent.
 */

interface TraceEntry {
  timestamp: string;
  tool: string;
  args: unknown;
  verdict: string;
  result: unknown;
}

const config = loadConfig();
const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
const fixtures =
  requested[0] === "all"
    ? ["legit", "lookalike", "prompt-injection"]
    : [requested[0] ?? config.fixtureName];

const DEMO_EPOCH = Date.parse("2026-01-01T00:00:00.000Z");
const trace: TraceEntry[] = [];
let sequence = 0;

function timestamp(): string {
  return config.demo
    ? new Date(DEMO_EPOCH + sequence++ * 1000).toISOString()
    : new Date().toISOString();
}

function record(tool: string, args: unknown, verdict: string, result: unknown): void {
  const entry: TraceEntry = { timestamp: timestamp(), tool, args, verdict, result };
  trace.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function say(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function runFixture(name: string, raw: RawPaymentRequest, tools: PaymentTools): Promise<void> {
  say(`\n[${name}] ${raw.id}: ${raw.description ?? "payment request"}`);

  // Memo text stays data: the mock extractor flags embedded instructions but
  // never treats them as commands.
  const proposed = await extractPaymentRequest(raw, config);
  say(`  LLM(${proposed.provider}) proposed: agentId=${proposed.agentId ?? "-"} name=${proposed.name ?? "-"} address=${proposed.address ?? "-"}`);
  if (proposed.injection.flags.length > 0) {
    say(`  Injection flags (ignored as instructions): ${proposed.injection.flags.join(", ")}`);
  }

  const policy = await tools.getPolicy();
  record("get_policy", {}, "N/A", policy);

  const resolution = await tools.resolvePayee({
    name: proposed.name,
    address: proposed.address,
    agentId: proposed.agentId,
  });
  record(
    "resolve_payee",
    { name: proposed.name, address: proposed.address, agentId: proposed.agentId },
    resolution.verdict,
    resolution,
  );
  say(`  resolve_payee: ${resolution.verdict} (${resolution.reason})`);
  if (resolution.verdict !== "OK") {
    say("  STOPPED: policy did not approve the payee. No alternate address was tried.");
    return;
  }

  const proposal = await tools.proposePayment({
    agentId: proposed.agentId ?? "",
    amount: proposed.amount,
    memo: proposed.memo,
  });
  record(
    "propose_payment",
    { agentId: proposed.agentId, amount: proposed.amount, memo: proposed.memo },
    proposal.verdict,
    proposal,
  );
  say(`  propose_payment: ${proposal.approval.status} — ${proposal.summary}`);
  if (proposal.approval.status === "REJECTED" || proposal.allowlist === "NOT_ALLOWLISTED") {
    say(`  STOPPED: ${proposal.approval.reason}. No alternate address was tried.`);
    return;
  }
  if (proposal.approval.status === "REQUIRES_OWNER_APPROVAL") {
    say(`  STOPPED: ${proposal.approval.reason}. Owner approval is required; nothing was sent.`);
    return;
  }

  const execution = await tools.executePayment({ intentId: proposal.intentId! });
  record(
    "execute_payment",
    { intentId: proposal.intentId },
    execution.ok ? "OK" : execution.reason ?? "REJECTED",
    execution,
  );
  say(`  execute_payment: ${execution.ok ? `OK ${execution.txHash}` : `REJECTED ${execution.reason}`}`);

  const receipts = await tools.getReceipts();
  record("get_receipts", {}, "N/A", receipts);
  say(`  get_receipts: ${receipts.count} receipt(s), mode=${receipts.mode}`);

  const expected = raw.expected;
  if (expected) {
    const actualApproval = proposal.approval.status;
    const executed = execution?.ok === true;
    const matches =
      (!expected.verdict || expected.verdict === resolution.verdict) &&
      (!expected.approval ||
        (expected.approval === "REJECTED" && resolution.verdict !== "OK") ||
        expected.approval === actualApproval) &&
      (expected.executed === undefined || expected.executed === executed);
    say(`  fixture expectation: ${matches ? "MATCH" : `MISMATCH (expected ${JSON.stringify(expected)})`}`);
    if (!matches) process.exitCode = 1;
  }
}

for (const name of fixtures) {
  const raw = readFixture(name);
  // Fresh tool state per fixture: intent ids and demo receipts never leak across runs.
  await runFixture(name, raw, createPaymentTools(config));
}

mkdirSync(dirname(config.tracePath), { recursive: true });
writeFileSync(config.tracePath, `${trace.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
say(`\nWrote ${trace.length} trace entries to ${config.tracePath}`);
if (config.demo) say("Demo mode: no RPC calls, no signing keys, no LLM API key required.");
else if (!config.registryAddress || !config.paymentAddress) {
  say("Live mode warning: registry/payment contracts are not configured; tools fail closed.");
}
