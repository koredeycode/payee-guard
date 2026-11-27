import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  parseUnits,
  toEventSelector,
  toHex,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AEVUM_FORK_CHAIN_ID,
  ANVIL_ACCOUNTS,
  aevumFork,
  aevumTestnet,
  txUrl,
  TUSD8_ADDRESS,
} from "../packages/aevum/src/index.ts";
import { intentProposedEvent, paymentRejectedEvent, paymentSentEvent, reasonLabel, tokenMintAbi } from "./abi.ts";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

export type Mode = "live" | "fork";

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing ${name}. See the env table in the PR / scripts source.`);
  return value;
}

export function optionalAddress(name: string): Address | undefined {
  const value = env(name);
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
}

export function requiredAddress(name: string): Address {
  const address = optionalAddress(name);
  if (!address) throw new Error(`Missing ${name}.`);
  return address;
}

/** Private keys are only read from the environment; they are never logged. */
export function optionalKey(name: string): Hex | undefined {
  const value = env(name);
  if (!value) return undefined;
  const key = (value.startsWith("0x") ? value : `0x${value}`) as Hex;
  if (!isHex(key) || key.length !== 66) throw new Error(`${name} must be a 32-byte hex private key.`);
  return key;
}

export function mode(): Mode {
  const value = (env("NETWORK") ?? "live").toLowerCase();
  if (value !== "live" && value !== "fork") throw new Error("NETWORK must be 'live' or 'fork'.");
  return value;
}

export function dryRun(): boolean {
  const value = (env("DRY_RUN") ?? "0").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function intEnv(name: string, fallback: number): number {
  const value = env(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number.`);
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Retry / backoff                                                            */
/* -------------------------------------------------------------------------- */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aevum's public RPC occasionally times out or rate-limits. Retry reads with
 * exponential backoff (+ jitter) rather than failing a whole demo run.
 */
export async function retryRpc<T>(
  label: string,
  fn: () => Promise<T>,
  options: { retries?: number; timeoutMs?: number; baseMs?: number; maxMs?: number } = {},
): Promise<T> {
  const retries = options.retries ?? intEnv("RPC_RETRIES", 5);
  const timeoutMs = options.timeoutMs ?? intEnv("RPC_READ_TIMEOUT_MS", 30_000);
  const baseMs = options.baseMs ?? intEnv("RPC_BACKOFF_MS", 400);
  const maxMs = options.maxMs ?? 8_000;

  for (let attempt = 0; ; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: RPC timeout after ${timeoutMs}ms`)), timeoutMs);
      });
      const result = await Promise.race([fn(), timeout]);
      if (timer) clearTimeout(timer);
      return result;
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (attempt >= retries) throw error;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * Math.max(1, backoff / 4));
      console.error(`  ↻ ${label} failed (${(error as Error).message}); retry ${attempt + 1}/${retries} in ${backoff + jitter}ms`);
      await sleep(backoff + jitter);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Clients and signers                                                        */
/* -------------------------------------------------------------------------- */

export interface Signer {
  address: Address;
  account: Account | Address;
  wallet: WalletClient;
  kind: "privateKey" | "jsonRpc";
}

export interface Context {
  mode: Mode;
  chain: Chain;
  rpcUrl: string;
  client: PublicClient;
  guard?: Address;
  registry?: Address;
  token: Address;
  owner?: Signer;
  agent?: Signer;
}

/** Connects to live (44005) or to `make fork` (440050) and refuses a wrong chain. */
export async function connect(options: { network?: Mode; signers?: boolean } = {}): Promise<Context> {
  const network = options.network ?? mode();
  const chain = network === "live" ? aevumTestnet : aevumFork;
  const rpcUrl = env("RPC_URL") ?? chain.rpcUrls.default.http[0];
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: intEnv("RPC_READ_TIMEOUT_MS", 30_000) }) });
  const chainId = await retryRpc("eth_chainId", () => client.getChainId());
  const expected = network === "live" ? aevumTestnet.id : AEVUM_FORK_CHAIN_ID;
  if (chainId !== expected) {
    throw new Error(
      `NETWORK=${network} expects chain ${expected}, but ${rpcUrl} is chain ${chainId}. ` +
        "Never use public anvil keys on the live chain.",
    );
  }

  const context: Context = {
    mode: network,
    chain,
    rpcUrl,
    client,
    guard: optionalAddress("GUARD_ADDRESS"),
    registry: optionalAddress("REGISTRY_ADDRESS"),
    token: optionalAddress("TUSD8_ADDRESS") ?? TUSD8_ADDRESS,
  };

  if (options.signers) {
    context.owner = makeSigner("OWNER", "OWNER_PRIVATE_KEY", "OWNER_ADDRESS", ANVIL_ACCOUNTS[0], chain, rpcUrl, network);
    context.agent = makeSigner("AGENT", "AGENT_PRIVATE_KEY", "AGENT_ADDRESS", ANVIL_ACCOUNTS[1], chain, rpcUrl, network);
  }
  return context;
}

/** Live: keys come from the environment. Fork: anvil's unlocked accounts (addresses only). */
export function makeSigner(
  label: string,
  keyName: string,
  addressName: string,
  forkFallback: Address,
  chain: Chain,
  rpcUrl: string,
  network: Mode,
): Signer {
  const key = optionalKey(keyName);
  if (key) {
    const account = privateKeyToAccount(key);
    if (network === "live" && ANVIL_ACCOUNTS.some((a) => a.toLowerCase() === account.address.toLowerCase())) {
      throw new Error(`${keyName} is a public anvil test key: refusing to use it on the live chain.`);
    }
    return {
      address: account.address,
      account,
      wallet: createWalletClient({ account, chain, transport: http(rpcUrl) }),
      kind: "privateKey",
    };
  }
  if (network === "live") throw new Error(`Missing ${keyName} (${label} key). Keys are read from the environment only.`);
  const address = optionalAddress(addressName) ?? forkFallback;
  return {
    address,
    account: address,
    wallet: createWalletClient({ account: address, chain, transport: http(rpcUrl) }),
    kind: "jsonRpc",
  };
}

export function signerForAddress(ctx: Context, label: string, keyName: string, address: Address): Signer {
  const key = optionalKey(keyName);
  if (key) {
    const account = privateKeyToAccount(key);
    return {
      address: account.address,
      account,
      wallet: createWalletClient({ account, chain: ctx.chain, transport: http(ctx.rpcUrl) }),
      kind: "privateKey",
    };
  }
  if (ctx.mode === "live") {
    throw new Error(`${label}: set ${keyName} in the environment to sign for ${address}.`);
  }
  return {
    address,
    account: address,
    wallet: createWalletClient({ account: address, chain: ctx.chain, transport: http(ctx.rpcUrl) }),
    kind: "jsonRpc",
  };
}

/** Legacy (type 0) everywhere: Aevum and its fork do not need EIP-1559 fields. */
export async function write(
  signer: Signer,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
): Promise<Hex> {
  return signer.wallet.writeContract({
    address,
    abi,
    functionName,
    args,
    account: signer.account,
    chain: signer.wallet.chain,
    type: "legacy",
  } as Parameters<WalletClient["writeContract"]>[0]);
}

export async function read<T>(
  client: PublicClient,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return retryRpc(functionName, () =>
    client.readContract({
      address,
      abi,
      functionName,
      args,
    } as Parameters<PublicClient["readContract"]>[0]),
  ) as Promise<T>;
}

export async function call(
  client: PublicClient,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  signer: Signer,
): Promise<void> {
  try {
    await retryRpc(`${functionName} (simulate)`, () =>
      client.simulateContract({
        address,
        abi,
        functionName,
        args,
        account: signer.address,
      } as Parameters<PublicClient["simulateContract"]>[0]),
    );
  } catch (error) {
    throw new Error(`${functionName} reverted: ${(error as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Receipts: inclusion only, explicitly provisional                           */
/* -------------------------------------------------------------------------- */

export interface ReceiptResult {
  receipt: TransactionReceipt;
  confirmations: number;
  /** Always provisional: a receipt is inclusion, not finality. */
  label: string;
}

/**
 * Polls for a receipt with a hard timeout. A receipt means "included", never
 * "final": every consumer prints the observed confirmation count instead.
 */
export async function waitForReceipt(
  client: PublicClient,
  hash: Hex,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ReceiptResult> {
  const timeoutMs = options.timeoutMs ?? intEnv("RECEIPT_TIMEOUT_MS", 900_000);
  const pollMs = options.pollMs ?? intEnv("RECEIPT_POLL_MS", 2_000);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await retryRpc(`getTransactionReceipt(${hash.slice(0, 10)}…)`, () =>
      client.getTransactionReceipt({ hash }),
    );
    if (receipt) {
      const head = await retryRpc("getBlockNumber", () => client.getBlockNumber());
      const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber) + 1 : 0;
      return { receipt, confirmations, label: `PROVISIONAL (${confirmations} confirmations)` };
    }
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for receipt ${hash}`);
    await sleep(pollMs);
  }
}

export interface PaymentOutcome {
  event: "PaymentSent" | "PaymentRejected";
  reason: string;
  args: Record<string, unknown>;
  log: Log;
}

/** Decodes the guard's payment outcome from a receipt (rejections succeed as txs). */
export function decodeOutcome(receipt: TransactionReceipt, guard: Address): PaymentOutcome | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== guard.toLowerCase()) continue;
    for (const [event, abi] of [
      ["PaymentSent", paymentSentEvent],
      ["PaymentRejected", paymentRejectedEvent],
    ] as const) {
      try {
        const decoded = decodeEventLog({ abi: [abi], data: log.data, topics: log.topics });
        if (decoded.eventName !== event) continue;
        const args = decoded.args as Record<string, unknown>;
        return {
          event,
          reason: event === "PaymentRejected" ? reasonLabel(String(args.reason ?? "")) : "accepted",
          args,
          log,
        };
      } catch {
        // Different topic: try the other event.
      }
    }
  }
  return undefined;
}

/**
 * `proposeIntent` returns `bytes32` only as a call return value, so the id must be
 * read from the `IntentProposed` log in its receipt. The indexed intentId is topics[1].
 */
export function intentIdFromReceipt(receipt: TransactionReceipt, guard: Address): Hex {
  const topic = toEventSelector(intentProposedEvent).toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== guard.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== topic) continue;
    const intentId = log.topics[1];
    if (intentId) return intentId;
  }
  throw new Error("No IntentProposed event in the proposal receipt; cannot find the intentId.");
}

export function explorerUrl(hash: Hex, network: Mode, rpcUrl: string): string {
  return network === "live" ? txUrl(hash) : `${rpcUrl}/tx/${hash}`;
}

/* -------------------------------------------------------------------------- */
/* tUSD8 on a fork: no faucet needed                                          */
/* -------------------------------------------------------------------------- */

/** tUSD8's master minter on Aevum. On a fork anyone can impersonate it. */
export const TUSD8_MASTER_MINTER: Address = "0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1";

export async function rpcRequest(client: PublicClient, method: string, params: readonly unknown[]): Promise<unknown> {
  return retryRpc(method, () =>
    client.request({ method, params } as unknown as Parameters<PublicClient["request"]>[0]),
  );
}

/** Gives test accounts gas and tUSD8 on a local fork by impersonating the master minter. */
export async function fundFork(ctx: Context, accounts: readonly Address[], units = "1000"): Promise<void> {
  if (ctx.mode !== "fork") throw new Error("fundFork is only allowed on a local fork.");
  const gas = "0x8ac7230489e80000"; // 10 tQDAY
  for (const address of accounts) await rpcRequest(ctx.client, "anvil_setBalance", [address, gas]);

  const minter = TUSD8_MASTER_MINTER;
  await rpcRequest(ctx.client, "anvil_impersonateAccount", [minter]);
  await rpcRequest(ctx.client, "anvil_setBalance", [minter, gas]);
  try {
    const signer: Signer = {
      address: minter,
      account: minter,
      wallet: createWalletClient({ account: minter, chain: ctx.chain, transport: http(ctx.rpcUrl) }),
      kind: "jsonRpc",
    };
    await write(signer, ctx.token, tokenMintAbi, "configureMinter", [minter, parseUnits("1", 6) * 1_000_000n]);
    for (const address of accounts) {
      await write(signer, ctx.token, tokenMintAbi, "mint", [address, parseUnits(units, 6)]);
    }
  } finally {
    await rpcRequest(ctx.client, "anvil_stopImpersonatingAccount", [minter]);
  }
}

/* -------------------------------------------------------------------------- */
/* Shared output helpers                                                      */
/* -------------------------------------------------------------------------- */

export function printTable(headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  console.log(line(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

/** Absolute path to a sibling file, independent of the caller's working directory. */
export function scriptPath(name: string): string {
  return fileURLToPath(new URL(`./${name}`, import.meta.url));
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

export function shortReason(reason: string): string {
  return reason.length > 54 ? `${reason.slice(0, 51)}…` : reason;
}

/** keccak256 of a UTF-8 string; used for stable demo intent IDs and metadata hashes. */
export function hashLabel(label: string): Hex {
  return keccak256(toHex(label));
}
