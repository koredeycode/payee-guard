import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readSigningKey, type AgentConfig, type KeyRole } from "./config.js";

export function chainFor(config: AgentConfig) {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 44005 ? "QDay Aevum Testnet" : `EVM chain ${config.chainId}`,
    nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    testnet: true,
  });
}

let cachedPublicClient: ReturnType<typeof createPublicClient> | undefined;

export function publicClientFor(config: AgentConfig) {
  if (config.demo) throw new Error("Offline demo mode never opens an RPC connection");
  cachedPublicClient ??= createPublicClient({
    chain: chainFor(config),
    transport: http(config.rpcUrl),
  });
  return cachedPublicClient;
}

/** Wallet clients are built only inside executePayment, after policy approval. */
export function walletClientFor(config: AgentConfig, role: KeyRole) {
  if (config.demo) throw new Error("Offline demo mode never signs transactions");
  const key = readSigningKey(role);
  if (!key) {
    throw new Error(
      `Missing ${role === "owner" ? "OWNER_PRIVATE_KEY" : "AGENT_PRIVATE_KEY"} for ${role} approval`,
    );
  }
  const account = privateKeyToAccount(key);
  return createWalletClient({
    account,
    chain: chainFor(config),
    transport: http(config.rpcUrl),
  });
}