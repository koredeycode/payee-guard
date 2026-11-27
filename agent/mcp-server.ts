#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./lib/config.js";
import { createPaymentTools } from "./lib/tools.js";

const config = loadConfig();
const tools = createPaymentTools(config);
const server = new McpServer({ name: "payee-guard", version: "0.1.0" });

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

async function safe<T>(operation: () => Promise<T>): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    return asText(await operation());
  } catch (error) {
    // Never return a stack trace or a signing key over stdio.
    const message = error instanceof Error ? error.message : String(error);
    return asText({ error: message.replace(/0x[0-9a-f]{64}/gi, "[redacted]") });
  }
}

server.registerTool(
  "resolve_payee",
  {
    title: "Resolve payee",
    description:
      "Check a claimed name, address or agentId against the Payee Guard identity registry. " +
      "Returns verdict (OK / NAME_SPOOF / UNKNOWN / INACTIVE), trust tier, evidence and name diff.",
    inputSchema: {
      name: z.string().optional().describe("Claimed payee name (untrusted)"),
      address: z.string().optional().describe("Claimed payee address (untrusted)"),
      agentId: z.string().optional().describe("Claimed registry agent id (untrusted)"),
    },
  },
  async (args) => safe(() => tools.resolvePayee(args)),
);

server.registerTool(
  "propose_payment",
  {
    title: "Propose payment",
    description:
      "Propose an intent from the resolved registry agentId. The payee address is read from the " +
      "registry, never from the model. Returns intentId, summary and approval status.",
    inputSchema: {
      agentId: z.string().min(1).describe("Registry agent id of the payee"),
      amount: z.string().min(1).describe("Decimal amount, at most 6 places"),
      memo: z.string().describe("Payment memo (untrusted data)"),
    },
  },
  async (args) => safe(() => tools.proposePayment(args)),
);

server.registerTool(
  "execute_payment",
  {
    title: "Execute payment",
    description:
      "Execute an approved intent. Returns a transaction hash, or the exact rejection reason " +
      "(including NOT_ALLOWLISTED). Never retries with a different payee.",
    inputSchema: { intentId: z.string().min(1).describe("Intent id returned by propose_payment") },
  },
  async (args) => safe(() => tools.executePayment(args)),
);

server.registerTool(
  "get_policy",
  {
    title: "Get policy",
    description: "Read the active payment policy (trust tier, auto-approval limit, allowlist rules).",
  },
  async () => safe(() => tools.getPolicy()),
);

server.registerTool(
  "get_receipts",
  {
    title: "Get receipts",
    description: "List PaymentExecuted receipts, from local demo state or the payment contract logs.",
  },
  async () => safe(() => tools.getReceipts()),
);

await server.connect(new StdioServerTransport());
process.stderr.write(
  `Payee Guard MCP ready: mode=${config.demo ? "offline-demo" : "live"}, chain=${config.chainId}\n`,
);
