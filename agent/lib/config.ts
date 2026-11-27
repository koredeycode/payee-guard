import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";

export type KeyRole = "owner" | "agent";

export interface AgentConfig {
  /** No RPC, no wallet, no LLM key: everything comes from local fixtures. */
  demo: boolean;
  llmProvider: "mock" | "openai-compatible";
  rpcUrl: string;
  chainId: number;
  registryAddress?: Address;
  policyAddress?: Address;
  paymentAddress?: Address;
  agentId: string;
  tracePath: string;
  fixtureName: string;
  llmApiUrl: string;
  llmModel: string;
  llmApiKey?: string;
  /** Intent ids the owner has approved out of band; nothing is auto-approved by this list. */
  ownerApprovedIntentIds: Set<string>;
}

function optionalAddress(value: string | undefined): Address | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const llmProvider = env.LLM_PROVIDER === "openai-compatible" ? "openai-compatible" : "mock";
  return {
    demo: env.MCP_DEMO === "1" || llmProvider === "mock",
    llmProvider,
    rpcUrl: env.RPC_URL ?? "https://rpc-test.qday.info",
    chainId: Number(env.CHAIN_ID ?? "44005"),
    registryAddress: optionalAddress(env.PAYEE_REGISTRY_ADDRESS),
    policyAddress: optionalAddress(env.PAYEE_POLICY_ADDRESS),
    paymentAddress: optionalAddress(env.PAYMENT_CONTRACT_ADDRESS),
    agentId: env.AGENT_ID ?? "payee-guard-worker",
    tracePath: env.TRACE_PATH ?? fileURLToPath(new URL("../trace.jsonl", import.meta.url)),
    fixtureName: env.FIXTURE ?? "legit",
    llmApiUrl: env.LLM_API_URL ?? "https://api.openai.com/v1/chat/completions",
    llmModel: env.LLM_MODEL ?? "gpt-4o-mini",
    llmApiKey: env.LLM_API_KEY,
    ownerApprovedIntentIds: new Set(
      (env.OWNER_APPROVED_INTENTS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  };
}

/**
 * Read a signing key at the moment a transaction is needed, never at startup.
 * The value is used by viem in memory and is never placed in config, a result,
 * a trace, or a log message.
 */
export function readSigningKey(role: KeyRole, env: NodeJS.ProcessEnv = process.env): Hex | undefined {
  const raw = env[role === "owner" ? "OWNER_PRIVATE_KEY" : "AGENT_PRIVATE_KEY"];
  if (!raw) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`Malformed ${role} signing key: expected 0x followed by 64 hex digits`);
  }
  return raw as Hex;
}
