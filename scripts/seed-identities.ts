import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  getAddress,
  isAddress,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { ANVIL_ACCOUNTS } from "../packages/aevum/src/index.ts";
import { agentWalletTypes, registryAbi } from "./abi.ts";
import {
  connect,
  dryRun,
  env,
  hashLabel,
  mode,
  optionalAddress,
  makeSigner,
  printTable,
  read,
  scriptPath,
  shortHash,
  waitForReceipt,
  write,
  type Context,
  type Signer,
} from "./shared.ts";

const STATE_PATH = scriptPath(".demo-identities.json");
const HASH_KEY = "payee-guard:registration-hash";
const ROLE_KEY = "payee-guard:role";
const NETWORK_KEY = "payee-guard:network";

const NAMES = [
  "Payee Guard Demo — trusted payee",
  "Payee Guard Demo — lookalike payee",
  "Payee Guard Demo — high-value payee",
  "Payee Guard Demo — rotated payee",
] as const;

export interface DemoIdentity {
  name: string;
  agentId: string;
  wallet: Address;
  metadataHash: Hex;
  agentUri: string;
  txHash: Hex;
}

interface IdentityState {
  network: "live" | "fork";
  chainId: number;
  registry: Address;
  generatedAt: string;
  identities: DemoIdentity[];
}

function registrationFile(name: string, registry: Address, chainId: number, agentId: number, wallet: Address) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name,
    description: "Demo payee identity used by Payee Guard's eight-scenario reproduction.",
    image: "",
    services: [{ name: "A2A", endpoint: `https://example.invalid/payee-guard/${agentId}`, version: "0.3.0" }],
    x402Support: false,
    active: true,
    registrations: [{ agentId, agentRegistry: `eip155:${chainId}:${registry}` }],
    supportedTrust: ["reputation"],
    wallet,
  };
}

function dataUri(json: string): string {
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}

function resolveWallets(network: "live" | "fork"): Address[] {
  return NAMES.map((_, index) => {
    const fromEnv = env(`PAYEE_${index + 1}_ADDRESS`);
    if (fromEnv) {
      if (!isAddress(fromEnv)) throw new Error(`PAYEE_${index + 1}_ADDRESS is invalid.`);
      return getAddress(fromEnv);
    }
    if (network === "live") throw new Error(`Missing PAYEE_${index + 1}_ADDRESS for live registration.`);
    // 0..3 are owner/agent; payees start at account 4 so gas accounts stay separate.
    return ANVIL_ACCOUNTS[index + 4]!;
  });
}

export async function runSeed(): Promise<void> {
  if (dryRun()) {
    const network = mode();
    const wallets = resolveWallets("fork"); // placeholders only; dry run never sends a transaction
    const registry = optionalAddress("REGISTRY_ADDRESS") ?? "0x0000000000000000000000000000000000000000";
    printTable(
      ["#", "name", "wallet (no keys used)", "planned call"],
      NAMES.map((name, index) => [
        String(index + 1),
        name,
        wallets[index]!,
        "register(uri, metadata) + setAgentURI + setMetadata + optional setAgentWallet",
      ]),
    );
    console.log(`DRY_RUN: no keys read, no transactions sent; registry ${registry} on ${network}.`);
    return;
  }

  const ctx = await connect({ signers: true });
  if (!ctx.registry) throw new Error("Missing REGISTRY_ADDRESS.");
  const registry = ctx.registry;
  const chainId = Number(ctx.chain.id);
  const owner = ctx.owner!;
  const wallets = resolveWallets(ctx.mode);

  const identities: DemoIdentity[] = [];
  const chain = ctx.chain;
  const rpcUrl = ctx.rpcUrl;

  for (let index = 0; index < NAMES.length; index++) {
    const name = NAMES[index]!;
    const wallet = wallets[index]!;
    const preliminary = JSON.stringify(registrationFile(name, registry, chainId, 0, wallet));
    const hash = hashLabel(preliminary);
    const metadata = [
      { metadataKey: ROLE_KEY, metadataValue: toHex("demo-payee") },
      { metadataKey: NETWORK_KEY, metadataValue: toHex(ctx.mode) },
    ];

    let txHash: Hex;
    try {
      txHash = await write(owner, registry, registryAbi, "register", [dataUri(preliminary), metadata]);
    } catch (error) {
      // Registries without the MetadataEntry[] overload still satisfy ERC-8004.
      console.error(`  register(uri, metadata) unavailable (${(error as Error).message}); trying register(uri)`);
      txHash = await write(owner, registry, registryAbi, "register", [dataUri(preliminary)]);
    }
    const { receipt } = await waitForReceipt(ctx.client, txHash);
    const registered = parseEventLogs({ abi: registryAbi, eventName: "Registered", logs: receipt.logs });
    const agentId = registered[0]?.args.agentId;
    if (agentId === undefined) throw new Error(`No Registered event in ${txHash}; cannot determine agentId.`);
    const id = Number(agentId);

    const finalJson = JSON.stringify(registrationFile(name, registry, chainId, id, wallet));
    const finalHash = hashLabel(finalJson);
    const finalUri = dataUri(finalJson);
    const storedUri = await read<string>(ctx.client, registry, registryAbi, "tokenURI", [agentId]);
    if (storedUri !== finalUri) {
      const uriTx = await write(owner, registry, registryAbi, "setAgentURI", [agentId, finalUri]);
      await waitForReceipt(ctx.client, uriTx);
    }
    const metaTx = await write(owner, registry, registryAbi, "setMetadata", [agentId, HASH_KEY, toHex(finalHash)]);
    await waitForReceipt(ctx.client, metaTx);

    // Binding is optional on live: it needs a signature from the payee wallet.
    const keyName = `PAYEE_${index + 1}_PRIVATE_KEY`;
    let walletSigner: Signer | undefined;
    try {
      walletSigner = makeSigner(`payee ${index + 1}`, keyName, `PAYEE_${index + 1}_ADDRESS`, wallet, chain, rpcUrl, ctx.mode);
      if (walletSigner.address.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error(`${keyName} belongs to ${walletSigner.address}, but the identity wallet is ${wallet}.`);
      }
    } catch (error) {
      console.error(`  Skipping agentWallet binding for #${id}: ${(error as Error).message}`);
    }
    if (walletSigner) {
      const block = await ctx.client.getBlock();
      const deadline = BigInt(block.timestamp) + 240n;
      const signature = await walletSigner.wallet.signTypedData({
        domain: {
          name: "ERC8004IdentityRegistry",
          version: "1",
          chainId,
          verifyingContract: registry,
        },
        types: agentWalletTypes,
        primaryType: "AgentWalletSet",
        message: { agentId, newWallet: wallet, owner: owner.address, deadline },
      });
      const bindTx = await write(owner, registry, registryAbi, "setAgentWallet", [agentId, wallet, deadline, signature]);
      await waitForReceipt(ctx.client, bindTx);
    }

    const onChainOwner = await read<Address>(ctx.client, registry, registryAbi, "ownerOf", [agentId]);
    if (onChainOwner.toLowerCase() !== owner.address.toLowerCase()) {
      throw new Error(`Agent #${id} is owned by ${onChainOwner}, expected ${owner.address}.`);
    }
    const onChainHash = await read<Hex>(ctx.client, registry, registryAbi, "getMetadata", [agentId, HASH_KEY]);
    if (onChainHash.toLowerCase() !== toHex(finalHash).toLowerCase()) {
      throw new Error(`Metadata hash mismatch for agent #${id}.`);
    }
    if (walletSigner) {
      const onChainWallet = await read<Address>(ctx.client, registry, registryAbi, "getAgentWallet", [agentId]);
      if (onChainWallet.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error(`agentWallet mismatch for agent #${id}.`);
      }
    }

    identities.push({ name, agentId: String(id), wallet, metadataHash: finalHash, agentUri: finalUri, txHash });
    console.log(`  ✓ identity #${id} registered and verified (${shortHash(finalHash)})`);
  }

  const state: IdentityState = {
    network: ctx.mode,
    chainId,
    registry,
    generatedAt: new Date().toISOString(),
    identities,
  };
  mkdirSync(scriptPath("."), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  printTable(
    ["agentId", "name", "wallet", "metadata hash (keccak256)", "registration tx"],
    identities.map((identity) => [
      identity.agentId,
      identity.name,
      shortHash(identity.wallet),
      shortHash(identity.metadataHash),
      shortHash(identity.txHash),
    ]),
  );
  console.log(`Saved ${identities.length} identities to ${STATE_PATH}`);
}

/** Used by deploy-and-seed.ts without spawning a second Node process. */
export async function main(): Promise<void> {
  await runSeed();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(`seed-identities: ${(error as Error).message}`);
    process.exit(1);
  });
}

export function loadIdentities(): IdentityState {
  if (!existsSync(STATE_PATH)) {
    throw new Error(`Missing ${STATE_PATH}. Run 'pnpm seed' or set AGENT_IDS.`);
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as IdentityState;
}

export const IDENTITY_STATE_PATH = STATE_PATH;
export const HASH_METADATA_KEY = HASH_KEY;
