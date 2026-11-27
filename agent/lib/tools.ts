import {
  formatUnits,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { publicClientFor, walletClientFor } from "./clients.js";
import type { AgentConfig, KeyRole } from "./config.js";
import {
  demoIdentities,
  demoPolicy,
  type IdentityRecord,
  type Policy,
  type TrustTier,
} from "./demo-data.js";
import { scanMemo } from "./injection.js";
import { confusableSkeleton, diffName, metadataHash, nameHash, type NameDiff } from "./verdict.js";

/**
 * Live mode reads these functions from our own registry/policy/payment contracts.
 * Demo mode never touches them. If an address is not configured, tools fail closed
 * with UNKNOWN / NOT_ALLOWLISTED instead of trusting the LLM's address.
 */
const registryAbi = parseAbi([
  "function agentIds() view returns (string[] ids)",
  "function resolveByAgentId(string agentId) view returns (address payeeAddress, string name, bool active, uint8 trustTier, string identityType, string[] services)",
]);
const policyAbi = parseAbi([
  "function isAllowed(address payee) view returns (bool)",
  "function maxAutoApprove() view returns (uint256)",
  "function requiredTier() view returns (uint8)",
]);
const paymentAbi = parseAbi([
  "function executeIntent(bytes32 intentId, address payee, uint256 amount)",
]);
const paymentEvent = parseAbi([
  "event PaymentExecuted(bytes32 indexed intentId, address indexed payee, uint256 amount)",
])[0];

export type Verdict = "OK" | "NAME_SPOOF" | "UNKNOWN" | "INACTIVE";
export type Allowlist = "ALLOWLISTED" | "NOT_ALLOWLISTED";
export type ApprovalStatus = "APPROVED" | "REQUIRES_OWNER_APPROVAL" | "REJECTED";

export interface ResolveInput {
  name?: string;
  address?: string;
  agentId?: string;
}

export interface ResolveEvidence {
  requested: { name?: string; address?: string; agentId?: string };
  resolved?: {
    agentId: string;
    name: string;
    address: Address;
    active: boolean;
    trustTier: TrustTier;
  };
  hashes?: { nameHash: Hex; metadataHash: Hex };
  source: string;
  matchedBy: "agentId" | "address" | "name" | "none";
}

export interface ResolveResult {
  verdict: Verdict;
  reason: string;
  trustTier: TrustTier;
  evidence: ResolveEvidence;
  nameDiff: NameDiff;
}

export interface ProposalInput {
  agentId: string;
  amount: string;
  memo: string;
}

export interface ProposalResult {
  intentId: string | null;
  summary: string;
  approval: { status: ApprovalStatus; reason: string };
  verdict: Verdict | "INVALID";
  trustTier: TrustTier;
  allowlist: Allowlist;
  flags: string[];
  payee?: { agentId: string; name: string; address: Address };
  policyVersion: string;
}

export interface Receipt {
  intentId: Hex;
  txHash: Hex;
  payee: Address;
  amount: string;
  timestamp: string;
  mode: "demo" | "live";
}

export interface ExecutionResult {
  ok: boolean;
  reason?: string;
  txHash?: Hex;
  mode: "demo" | "live";
  summary: string;
  receipt?: Receipt;
}

interface IdentityView {
  agentId: string;
  name: string;
  address: Address;
  active: boolean;
  trustTier: TrustTier;
  type?: string;
  services?: string[];
  registrations?: unknown[];
}

interface Intent {
  intentId: Hex;
  agentId: string;
  payeeName: string;
  payee: Address;
  amount: string;
  memo: string;
  approval: { status: ApprovalStatus; reason: string };
  policy: Policy;
  createdAt: string;
}

export interface PaymentTools {
  resolvePayee(input: ResolveInput): Promise<ResolveResult>;
  proposePayment(input: ProposalInput): Promise<ProposalResult>;
  executePayment(input: { intentId: string }): Promise<ExecutionResult>;
  getPolicy(): Promise<Policy>;
  getReceipts(): Promise<{ mode: "demo" | "live"; count: number; receipts: Receipt[]; note?: string }>;
}

const DEMO_EPOCH = Date.parse("2026-01-01T00:00:00.000Z");
const lower = (address: string): string => address.toLowerCase();
const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

function asTier(value: unknown): TrustTier {
  if (value === 2 || (typeof value === "bigint" && value === 2n)) return "verified";
  if (value === 1 || (typeof value === "bigint" && value === 1n)) return "provisional";
  if (typeof value === "string" && ["verified", "provisional", "unverified"].includes(value)) {
    return value as TrustTier;
  }
  return "unverified";
}

function fromDemoRecord(record: IdentityRecord): IdentityView {
  return {
    agentId: record.agentId,
    name: record.name,
    address: record.address,
    active: record.active,
    trustTier: record.trustTier,
    type: record.type,
    services: record.services,
    registrations: record.registrations,
  };
}

function safeReason(error: unknown): string {
  const raw = error instanceof Error
    ? ((error as Error & { shortMessage?: string }).shortMessage ?? error.message)
    : String(error);
  // A key must never escape, even via an unusual error message.
  const message = raw.replace(/0x[0-9a-f]{64}/gi, "[redacted]").slice(0, 200);
  if (/NOT_ALLOWLISTED/i.test(message)) return "NOT_ALLOWLISTED";
  if (/NAME_SPOOF|SPOOF/i.test(message)) return "NAME_SPOOF";
  if (/UNKNOWN_PAYEE/i.test(message)) return "UNKNOWN";
  if (/ALREADY|already executed/i.test(message)) return "ALREADY_EXECUTED";
  if (/insufficient/i.test(message)) return "INSUFFICIENT_FUNDS";
  return `CONTRACT_REVERT: ${message}`;
}

export function createPaymentTools(config: AgentConfig): PaymentTools {
  const intents = new Map<Hex, Intent>();
  const receipts: Receipt[] = [];
  let sequence = 0;
  const demoTime = (): string => new Date(DEMO_EPOCH + sequence * 1000).toISOString();

  async function loadIdentities(): Promise<{ identities: IdentityView[]; source: string }> {
    if (config.demo) {
      return { identities: demoIdentities().map(fromDemoRecord), source: "fixtures/identities.json" };
    }
    if (!config.registryAddress) {
      return { identities: [], source: "PAYEE_REGISTRY_ADDRESS not configured" };
    }
    try {
      const client = publicClientFor(config);
      const ids = await client.readContract({
        address: config.registryAddress,
        abi: registryAbi,
        functionName: "agentIds",
      });
      const identities = await Promise.all(
        ids.slice(0, 100).map(async (agentId): Promise<IdentityView> => {
          const row = (await client.readContract({
            address: config.registryAddress!,
            abi: registryAbi,
            functionName: "resolveByAgentId",
            args: [agentId],
          })) as unknown as {
            payeeAddress: Address;
            name: string;
            active: boolean;
            trustTier: number;
            identityType: string;
            services: string[];
          };
          return {
            agentId,
            name: row.name,
            address: row.payeeAddress,
            active: row.active,
            trustTier: asTier(row.trustTier),
            type: row.identityType,
            services: row.services,
          };
        }),
      );
      return { identities, source: `chain:${config.registryAddress}` };
    } catch {
      return { identities: [], source: "registry read failed" };
    }
  }

  async function resolvePayee(input: ResolveInput): Promise<ResolveResult> {
    const requestedName = typeof input.name === "string" && input.name.trim() ? input.name : undefined;
    const requestedAddress =
      typeof input.address === "string" && isAddress(input.address) ? input.address : undefined;
    const requestedAgentId = typeof input.agentId === "string" && input.agentId.trim() ? input.agentId.trim() : undefined;
    const evidence: ResolveEvidence = {
      requested: { name: requestedName, address: requestedAddress, agentId: requestedAgentId },
      source: "none",
      matchedBy: "none",
    };

    if (!requestedName && !requestedAddress && !requestedAgentId) {
      return {
        verdict: "UNKNOWN",
        reason: "Supply at least a name, address or agentId",
        trustTier: "unverified",
        evidence,
        nameDiff: diffName("", ""),
      };
    }
    if (typeof input.address === "string" && input.address.trim() && !requestedAddress) {
      return {
        verdict: "UNKNOWN",
        reason: "The supplied payee address is not a valid EVM address",
        trustTier: "unverified",
        evidence,
        nameDiff: diffName(requestedName ?? "", ""),
      };
    }

    const { identities, source } = await loadIdentities();
    evidence.source = source;
    const byAgent = requestedAgentId
      ? identities.find((record) => record.agentId === requestedAgentId)
      : undefined;
    const byAddress = requestedAddress
      ? identities.find((record) => lower(record.address) === lower(requestedAddress))
      : undefined;
    const byName = requestedName
      ? identities.find(
          (record) => confusableSkeleton(record.name) === confusableSkeleton(requestedName),
        )
      : undefined;
    const resolved = byAgent ?? byAddress ?? byName;
    evidence.matchedBy = byAgent ? "agentId" : byAddress ? "address" : byName ? "name" : "none";

    if (!resolved) {
      return {
        verdict: "UNKNOWN",
        reason: "No registry identity matches the supplied name, address and agentId",
        trustTier: "unverified",
        evidence,
        nameDiff: diffName(requestedName ?? "", ""),
      };
    }

    evidence.resolved = {
      agentId: resolved.agentId,
      name: resolved.name,
      address: resolved.address,
      active: resolved.active,
      trustTier: resolved.trustTier,
    };
    evidence.hashes = {
      nameHash: nameHash(resolved.name),
      metadataHash: metadataHash({
        type: resolved.type,
        name: resolved.name,
        active: resolved.active,
        services: resolved.services,
        registrations: resolved.registrations,
      }),
    };
    const nameDiff = diffName(requestedName ?? resolved.name, resolved.name);

    const conflicts: string[] = [];
    if (byAgent && byAddress && byAgent.agentId !== byAddress.agentId) {
      conflicts.push("agentId and supplied address resolve to different identities");
    }
    if (byName && byName.agentId !== resolved.agentId) {
      conflicts.push("name skeleton matches a different registry identity");
    }
    if (requestedAddress && lower(resolved.address) !== lower(requestedAddress)) {
      conflicts.push("supplied address is not the registry address for this identity");
    }
    if (requestedAgentId && resolved.agentId !== requestedAgentId) {
      conflicts.push("agentId mismatch");
    }
    if (requestedName && !nameDiff.skeletonMatch) {
      conflicts.push("name skeleton mismatch");
    }
    if (conflicts.length > 0) {
      return {
        verdict: "NAME_SPOOF",
        reason: conflicts.join("; "),
        trustTier: resolved.trustTier,
        evidence,
        nameDiff,
      };
    }
    if (!resolved.active) {
      return {
        verdict: "INACTIVE",
        reason: "The registry identity is not active",
        trustTier: resolved.trustTier,
        evidence,
        nameDiff,
      };
    }
    return {
      verdict: "OK",
      reason: "Claimed name, agentId and address agree with the registry",
      trustTier: resolved.trustTier,
      evidence,
      nameDiff,
    };
  }

  async function getPolicy(): Promise<Policy> {
    if (config.demo) return { ...demoPolicy(), source: "fixtures/policy.json" };
    const failClosed: Policy = {
      version: "fail-closed",
      chainId: config.chainId,
      token: "tUSD8",
      tokenDecimals: 6,
      requiredTrustTier: "verified",
      maxAutoApprove: "0",
      requireAllowlist: true,
      rejectPromptInjection: true,
      source: "default (policy contract not configured)",
    };
    if (!config.policyAddress) return failClosed;
    try {
      const client = publicClientFor(config);
      const [limit, tier] = await Promise.all([
        client.readContract({ address: config.policyAddress, abi: policyAbi, functionName: "maxAutoApprove" }),
        client.readContract({ address: config.policyAddress, abi: policyAbi, functionName: "requiredTier" }),
      ]);
      return {
        ...failClosed,
        maxAutoApprove: formatUnits(limit, failClosed.tokenDecimals),
        requiredTrustTier: asTier(tier),
        source: `chain:${config.policyAddress}`,
      };
    } catch {
      return failClosed;
    }
  }

  async function isAllowlisted(address: Address, policy: Policy): Promise<Allowlist> {
    if (!policy.requireAllowlist) return "ALLOWLISTED";
    if (config.demo) {
      const found = demoIdentities().some(
        (record) => lower(record.address) === lower(address) && record.active && record.trustTier === "verified",
      );
      return found ? "ALLOWLISTED" : "NOT_ALLOWLISTED";
    }
    if (!config.policyAddress) return "NOT_ALLOWLISTED";
    try {
      const allowed = await publicClientFor(config).readContract({
        address: config.policyAddress,
        abi: policyAbi,
        functionName: "isAllowed",
        args: [address],
      });
      return allowed ? "ALLOWLISTED" : "NOT_ALLOWLISTED";
    } catch {
      return "NOT_ALLOWLISTED";
    }
  }

  async function proposePayment(input: ProposalInput): Promise<ProposalResult> {
    const policy = await getPolicy();
    const rejection = (
      verdict: ProposalResult["verdict"],
      reason: string,
      allowlist: Allowlist = "NOT_ALLOWLISTED",
    ): ProposalResult => ({
      intentId: null,
      summary: `Payment rejected: ${reason}`,
      approval: { status: "REJECTED", reason },
      verdict,
      trustTier: "unverified",
      allowlist,
      flags: [],
      policyVersion: policy.version,
    });

    if (!/^\d+(\.\d{1,6})?$/.test(input.amount) || Number(input.amount) <= 0) {
      return rejection("INVALID", "Amount must be a positive decimal with at most 6 places");
    }
    // Only agentId is accepted from the model. The payee address always comes
    // from the registry below; an LLM-supplied address is never used here.
    const resolution = await resolvePayee({ agentId: input.agentId });
    if (resolution.verdict !== "OK" || !resolution.evidence.resolved) {
      return rejection(resolution.verdict, resolution.reason);
    }
    const payee = resolution.evidence.resolved;
    const allowlist = await isAllowlisted(payee.address, policy);
    if (allowlist === "NOT_ALLOWLISTED") {
      return rejection("OK", "Payee is NOT_ALLOWLISTED by the policy contract", allowlist);
    }

    const flags = scanMemo(input.memo, payee.address).flags;
    const reasons: string[] = [];
    if (resolution.trustTier !== policy.requiredTrustTier) {
      reasons.push(`trust tier ${resolution.trustTier} is below ${policy.requiredTrustTier}`);
    }
    if (Number(input.amount) > Number(policy.maxAutoApprove)) {
      reasons.push(`amount exceeds the ${policy.maxAutoApprove} ${policy.token} auto-approval limit`);
    }
    if (policy.rejectPromptInjection && flags.length > 0) {
      reasons.push(`memo flags: ${flags.join(", ")}`);
    }
    const status: ApprovalStatus = reasons.length > 0 ? "REQUIRES_OWNER_APPROVAL" : "APPROVED";
    const createdAt = config.demo ? demoTime() : new Date().toISOString();
    const intentId = keccak256(
      stringToHex(
        JSON.stringify({
          domain: "payee-guard.intent.v1",
          chainId: config.chainId,
          agentId: input.agentId,
          payee: lower(payee.address),
          amount: input.amount,
          memo: input.memo,
          seq: ++sequence,
        }),
      ),
    );
    intents.set(intentId, {
      intentId,
      agentId: payee.agentId,
      payeeName: payee.name,
      payee: payee.address,
      amount: input.amount,
      memo: input.memo,
      approval: { status, reason: reasons.join("; ") || "Policy approved the intent" },
      policy,
      createdAt,
    });
    return {
      intentId,
      summary: `Pay ${input.amount} ${policy.token} to ${payee.name} (${short(payee.address)}) — ${status}`,
      approval: { status, reason: reasons.join("; ") || "Policy approved the intent" },
      verdict: resolution.verdict,
      trustTier: resolution.trustTier,
      allowlist,
      flags,
      payee: { agentId: payee.agentId, name: payee.name, address: payee.address },
      policyVersion: policy.version,
    };
  }

  async function executePayment(input: { intentId: string }): Promise<ExecutionResult> {
    const intentId = input.intentId as Hex;
    const intent = intents.get(intentId);
    if (!intent) {
      return { ok: false, reason: "UNKNOWN_INTENT", mode: config.demo ? "demo" : "live", summary: "No such intent" };
    }
    // Re-check at execution time: registry state can change after proposal.
    const recheck = await resolvePayee({
      agentId: intent.agentId,
      name: intent.payeeName,
      address: intent.payee,
    });
    if (recheck.verdict !== "OK") {
      return { ok: false, reason: recheck.verdict, mode: config.demo ? "demo" : "live", summary: `Stopped: ${recheck.reason}` };
    }
    const allowlist = await isAllowlisted(intent.payee, intent.policy);
    if (allowlist === "NOT_ALLOWLISTED") {
      return { ok: false, reason: "NOT_ALLOWLISTED", mode: config.demo ? "demo" : "live", summary: "Stopped: payee is not allowlisted" };
    }
    let signerRole: KeyRole = "agent";
    if (intent.approval.status !== "APPROVED") {
      // A human owner must opt in out of band by listing this exact intent id.
      if (
        intent.approval.status === "REQUIRES_OWNER_APPROVAL" &&
        config.ownerApprovedIntentIds.has(intentId)
      ) {
        signerRole = "owner";
      } else {
        return {
          ok: false,
          reason:
            intent.approval.status === "REQUIRES_OWNER_APPROVAL"
              ? "OWNER_APPROVAL_REQUIRED"
              : "NOT_APPROVED",
          mode: config.demo ? "demo" : "live",
          summary: `Stopped: ${intent.approval.reason}`,
        };
      }
    }
    if (config.demo) {
      const txHash = keccak256(stringToHex(`payee-guard.demo.tx:${intentId}`));
      const receipt: Receipt = {
        intentId,
        txHash,
        payee: intent.payee,
        amount: intent.amount,
        timestamp: new Date(DEMO_EPOCH + ++sequence * 1000).toISOString(),
        mode: "demo",
      };
      receipts.push(receipt);
      return {
        ok: true,
        txHash,
        mode: "demo",
        summary: `Demo execution of ${intent.amount} ${intent.policy.token} to ${intent.payeeName}; deterministic hash, no transaction was sent`,
        receipt,
      };
    }
    if (!config.paymentAddress) {
      return { ok: false, reason: "PAYMENT_CONTRACT_NOT_CONFIGURED", mode: "live", summary: "No payment contract configured" };
    }
    try {
      // The agent key is gas-only; the owner key is read only if the owner
      // explicitly approved this intent out of band.
      const wallet = walletClientFor(config, signerRole);
      const hash = await wallet.writeContract({
        address: config.paymentAddress,
        abi: paymentAbi,
        functionName: "executeIntent",
        args: [intentId, intent.payee, parseUnits(intent.amount, intent.policy.tokenDecimals)],
      });
      const transactionReceipt = await publicClientFor(config).waitForTransactionReceipt({ hash });
      if (transactionReceipt.status !== "success") {
        return { ok: false, reason: "CONTRACT_REVERT", txHash: hash, mode: "live", summary: "Transaction reverted" };
      }
      const receipt: Receipt = {
        intentId,
        txHash: hash,
        payee: intent.payee,
        amount: intent.amount,
        timestamp: new Date().toISOString(),
        mode: "live",
      };
      receipts.push(receipt);
      return {
        ok: true,
        txHash: hash,
        mode: "live",
        summary: `Paid ${intent.amount} ${intent.policy.token} to ${intent.payeeName}`,
        receipt,
      };
    } catch (error) {
      return {
        ok: false,
        reason: safeReason(error),
        mode: "live",
        summary: "Payment was not sent",
      };
    }
  }

  async function getReceipts() {
    if (config.demo) {
      return { mode: "demo" as const, count: receipts.length, receipts: [...receipts] };
    }
    if (!config.paymentAddress) {
      return {
        mode: "live" as const,
        count: 0,
        receipts: [] as Receipt[],
        note: "PAYMENT_CONTRACT_ADDRESS not configured",
      };
    }
    try {
      const client = publicClientFor(config);
      const policy = await getPolicy();
      const latest = await client.getBlockNumber();
      const from = latest > 100_000n ? latest - 100_000n : 0n; // bounded read
      const logs = [];
      for (let start = from; start <= latest; start += 1000n) {
        const end = start + 999n > latest ? latest : start + 999n;
        logs.push(
          ...(await client.getLogs({
            address: config.paymentAddress,
            event: paymentEvent,
            fromBlock: start,
            toBlock: end,
          })),
        );
      }
      return {
        mode: "live" as const,
        count: logs.length,
        receipts: logs.map((log): Receipt => ({
          intentId: log.args.intentId!,
          txHash: log.transactionHash,
          payee: log.args.payee!,
          amount: formatUnits(log.args.amount ?? 0n, policy.tokenDecimals),
          timestamp: new Date().toISOString(),
          mode: "live",
        })),
      };
    } catch {
      return { mode: "live" as const, count: 0, receipts: [] as Receipt[], note: "receipt read failed" };
    }
  }

  return { resolvePayee, proposePayment, executePayment, getPolicy, getReceipts };
}
