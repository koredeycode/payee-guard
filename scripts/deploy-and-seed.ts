import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { AEVUM_FORK_CHAIN_ID } from "../packages/aevum/src/index.ts";
import { runSeed } from "./seed-identities.ts";
import { env, sleep } from "./shared.ts";

const ROOT = resolve(env("APP_ROOT") ?? ".");
const CONTRACTS = join(ROOT, "contracts");
const BROADCAST = join(CONTRACTS, "broadcast");

interface BroadcastTx {
  contractName?: string;
  contractAddress?: string;
}

function run(command: string, args: string[], cwd = ROOT): void {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit", env: process.env as Record<string, string> });
}

async function waitForRpc(rpcUrl: string, attempts = 60): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const output = execFileSync("cast", ["chain-id", "--rpc-url", rpcUrl], { encoding: "utf8" }).trim();
      if (Number(output) === AEVUM_FORK_CHAIN_ID) return;
      throw new Error(`chain ${output}, expected ${AEVUM_FORK_CHAIN_ID}`);
    } catch (error) {
      if (attempt === attempts) throw new Error(`anvil fork not ready at ${rpcUrl}: ${(error as Error).message}`);
      await sleep(1_000);
    }
  }
}

/** Reads forge's `run-latest.json` so the seed gets the real deployed addresses. */
function deployedAddress(contractNames: readonly string[], chainId: number): Address | undefined {
  if (!existsSync(BROADCAST)) return undefined;
  const files: string[] = [];
  for (const script of readdirSync(BROADCAST)) {
    const dir = join(BROADCAST, script, String(chainId));
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file === "run-latest.json") files.push(join(dir, file));
    }
  }
  files.sort((a, b) => (readFileSync(b, "utf8").length - readFileSync(a, "utf8").length));
  for (const file of files) {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const transactions = (parsed as { transactions?: BroadcastTx[] }).transactions ?? [];
    for (const wanted of contractNames) {
      const match = transactions.find(
        (tx) => tx.contractName?.toLowerCase().includes(wanted.toLowerCase()) && !!tx.contractAddress,
      );
      if (match?.contractAddress && isAddress(match.contractAddress)) return getAddress(match.contractAddress);
    }
  }
  return undefined;
}

export async function runDeployAndSeed(): Promise<void> {
  const rpcUrl = env("RPC_URL") ?? "http://127.0.0.1:8555";
  const script = env("DEPLOY_SCRIPT") ?? "script/Deploy.s.sol";
  await waitForRpc(rpcUrl);

  // Throwaway impersonated deployer: no key exists, so fork addresses cannot be
  // claimed on the real testnet by whoever holds a public anvil account.
  const deployer = env("DEPLOY_ADDRESS")
    ? getAddress(env("DEPLOY_ADDRESS")!)
    : getAddress(`0x${randomBytes(20).toString("hex")}`);
  run("cast", ["rpc", "anvil_impersonateAccount", deployer, "--rpc-url", rpcUrl]);
  run("cast", ["rpc", "anvil_setBalance", deployer, "0x8ac7230489e80000", "--rpc-url", rpcUrl]);
  try {
    run("forge", ["build"], CONTRACTS);
    run(
      "forge",
      ["script", script, "--rpc-url", rpcUrl, "--broadcast", "--unlocked", "--sender", deployer],
      CONTRACTS,
    );
  } finally {
    run("cast", ["rpc", "anvil_stopImpersonatingAccount", deployer, "--rpc-url", rpcUrl]);
  }

  const guard = env("GUARD_ADDRESS") ? getAddress(env("GUARD_ADDRESS")!) : deployedAddress(
    (env("GUARD_CONTRACT_NAME") ?? "PayeeGuard").split(","),
    AEVUM_FORK_CHAIN_ID,
  );
  const registry = env("REGISTRY_ADDRESS") ? getAddress(env("REGISTRY_ADDRESS")!) : deployedAddress(
    (env("REGISTRY_CONTRACT_NAME") ?? "IdentityRegistry,ERC8004IdentityRegistry").split(","),
    AEVUM_FORK_CHAIN_ID,
  );
  if (!guard || !registry) {
    throw new Error(
      "Could not resolve deployed addresses from forge broadcast JSON. " +
        "Set GUARD_CONTRACT_NAME / REGISTRY_CONTRACT_NAME or GUARD_ADDRESS / REGISTRY_ADDRESS explicitly.",
    );
  }
  process.env.GUARD_ADDRESS = guard;
  process.env.REGISTRY_ADDRESS = registry;
  console.log(`Guard ${guard}  Registry ${registry}`);
  await runSeed();

  if ((env("RUN_DEMO_AFTER_SEED") ?? "1") === "1") {
    const { runDemo } = await import("./demo-flow.ts");
    await runDemo();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runDeployAndSeed().catch((error: unknown) => {
    console.error(`deploy-and-seed: ${(error as Error).message}`);
    process.exit(1);
  });
}

export const DEPLOY_SCRIPT_NAME = basename(env("DEPLOY_SCRIPT") ?? "script/Deploy.s.sol");
