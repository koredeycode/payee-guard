import {
  formatUnits,
  hexToString,
  isAddress,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
  type TransactionReceipt,
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
import {
  canonicalName,
  confusableSkeleton,
  diffName,
  metadataHash,
  nameHash,
  type NameDiff,
} from "./verdict.js";

/**
 * Live mode reads the real contracts: IdentityRegistry.getAgentWallet(uint256) and
 * PayeeGuard's payees / sessions / intents mappings, proposal + execution functions
 * and payment events. Demo mode never touches them. If an address is not configured,
 * tools fail closed with UNKNOWN / NOT_ALLOWLISTED instead of trusting the LLM's address.
 */
const payeeGuardAbi = parseAbi([
  "function payees(uint256 agentId) view returns (address wallet, bytes32 nameHash, bytes32 metadataHash, bool allowed)",
  "function sessionKey(uint256 agentId, address operator) pure returns (bytes32 key)",
  "function sessionOf(uint256 agentId, address operator) view returns ((uint256 maxPerPayment, uint256 maxCumulative, uint256 spent, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt, uint64 epoch, bool revoked))",
  "function sessions(bytes32 key) view returns ((uint256 maxPerPayment, uint256 maxCumulative, uint256 spent, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt, uint64 epoch, bool revoked))",
  "function intents(bytes32 intentId) view returns (uint256 agentId, address payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved, bool executed)",
  "function proposeIntent(uint256 agentId, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt) returns (bytes32 intentId)",
  "function approveIntent(bytes32 intentId)",
  "function executeIntent(bytes32 intentId)",
  "function tryExecuteIntent(bytes32 intentId) returns (bool)",
  // Exact topic0 signatures from PayeeGuard.sol — shorter fragments never match.
  "event IntentProposed(bytes32 indexed intentId, uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved)",
  "event PaymentSent(bytes32 indexed intentId, bytes32 indexed paymentRef, uint256 indexed agentId, address payee, uint256 amount, address caller)",
  "event PaymentRejected(bytes32 indexed intentId, address indexed caller, bytes32 reason)",
]);
const identityRegistryAbi = parseAbi([
  "function getAgentWallet(uint256 agentId) view returns (address wallet)",
]);
const paymentSentAbi = parseAbi([
  "event PaymentSent(bytes32 indexed intentId, bytes32 indexed paymentRef, uint256 indexed agentId, address payee, uint256 amount, address caller)",
]);
const paymentRejectedAbi = parseAbi([
  "event PaymentRejected(bytes32 indexed intentId, address indexed caller, bytes32 reason)",
]);

export type Verdict =
  | "OK"
  | "NAME_SPOOF"
  | "UNKNOWN"
  | "INACTIVE"
  | "PAYEE_CHANGED"
  | "NOT_ALLOWLISTED";
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
  /** Demo fixtures have a readable name; live identities expose only hashes. */
  payeeName?: string;
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
  getPolicy(agentId?: string): Promise<Policy>;
  getReceipts(): Promise<{ mode: "demo" | "live"; count: number; receipts: Receipt[]; note?: string }>;
}

const DEMO_EPOCH = Date.parse("2026-01-01T00:00:00.000Z");
const lower = (address: string): string => address.toLowerCase();
const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

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

/** Live agent ids are uint256; fixture ids are strings and stay untouched in demo mode. */
function parseAgentId(value: string | undefined): bigint | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = BigInt(value.trim());
  return parsed >= 0n ? parsed : undefined;
}

/** Decode a bytes32 PaymentRejected reason without ever surfacing a signing key. */
function decodeRejectReason(reason: Hex | undefined): string {
  if (!reason) return "CONTRACT_REJECTED";
  try {
    const text = hexToString(reason, { size: 32 })
      .replace(/\0+$/g, "")
      .trim();
    if (/^[\x20-\x7e]+$/.test(text)) return text.slice(0, 120);
  } catch {
    // Not an ASCII reason; fall through to the raw topic.
  }
  return `CONTRACT_REJECTED (${reason.slice(0, 18)}…)`;
}

/** The proposal receipt is the only place the on-chain intent id is available. */
export function intentIdFromReceipt(logs: TransactionReceipt["logs"]): Hex | undefined {
  try {
    // Exact topic0: viem only matches logs emitted with the PayeeGuard.sol signature.
    const parsed = parseEventLogs({
      abi: payeeGuardAbi,
      eventName: "IntentProposed",
      logs,
    }) as unknown as Array<{ args: { intentId?: Hex } }>;
    const intentId = parsed[0]?.args.intentId;
    return intentId ? (intentId as Hex) : undefined;
  } catch {
    return undefined;
  }
}

/** On chain we only have hashes; show that honestly instead of claiming a name match. */
function hashOnlyDiff(name: string | undefined, matches: boolean): NameDiff {
  const canonical = canonicalName(name ?? "");
  return {
    exact: matches,
    skeletonMatch: matches,
    canonical,
    expectedCanonical: "[on-chain nameHash only]",
    skeleton: confusableSkeleton(name ?? ""),
    expectedSkeleton: "[on-chain nameHash only]",
    invisibleCharacters: 0,
    differences: matches ? [] : ["nameHash differs from the on-chain payee nameHash"],
  };
}

export function createPaymentTools(config: AgentConfig): PaymentTools {
  const intents = new Map<Hex, Intent>();
  const receipts: Receipt[] = [];
  let sequence = 0;
  const demoTime = (): string => new Date(DEMO_EPOCH + sequence * 1000).toISOString();

  async function loadIdentities(): Promise<{ identities: IdentityView[]; source: string }> {
    // Demo fixtures only. Live resolution reads payees(agentId) directly below.
    return { identities: demoIdentities().map(fromDemoRecord), source: "fixtures/identities.json" };
  }

  interface LivePayee {
    wallet: Address;
    nameHash: Hex;
    metadataHash: Hex;
    allowed: boolean;
    registryWallet: Address;
  }

  async function readLivePayee(agentId: bigint): Promise<LivePayee> {
    const client = publicClientFor(config);
    const [payee, registryWallet] = await Promise.all([
      client.readContract({
        address: config.paymentAddress!,
        abi: payeeGuardAbi,
        functionName: "payees",
        args: [agentId],
      }) as unknown as {
        wallet: Address;
        nameHash: Hex;
        metadataHash: Hex;
        allowed: boolean;
      },
      client.readContract({
        address: config.registryAddress!,
        abi: identityRegistryAbi,
        functionName: "getAgentWallet",
        args: [agentId],
      }) as unknown as Address,
    ]);
    return {
      wallet: payee.wallet,
      nameHash: payee.nameHash,
      metadataHash: payee.metadataHash,
      allowed: payee.allowed,
      registryWallet,
    };
  }

  /** Sessions are keyed by (uint256 agentId, operator); epoch 0 means none exists. */
  async function readLiveSession(agentId: bigint) {
    if (!config.paymentAddress || !config.agentOperatorAddress) return undefined;
    try {
      const session = (await publicClientFor(config).readContract({
        address: config.paymentAddress,
        abi: payeeGuardAbi,
        functionName: "sessionOf",
        args: [agentId, config.agentOperatorAddress],
      })) as unknown as {
        maxPerPayment: bigint;
        maxCumulative: bigint;
        spent: bigint;
        autoApproveLimit: bigint;
        validAfter: bigint;
        expiresAt: bigint;
        epoch: bigint;
        revoked: boolean;
      };
      return session.epoch === 0n ? undefined : session;
    } catch {
      return undefined;
    }
  }

  async function resolveLivePayee(
    requestedName: string | undefined,
    requestedAddress: string | undefined,
    requestedAgentId: string | undefined,
    evidence: ResolveEvidence,
  ): Promise<ResolveResult> {
    const result = (
      verdict: Verdict,
      reason: string,
      trustTier: TrustTier = "unverified",
      nameDiff = hashOnlyDiff(requestedName, false),
    ): ResolveResult => ({ verdict, reason, trustTier, evidence, nameDiff });
    evidence.source = "chain:PayeeGuard.payees + IdentityRegistry.getAgentWallet";

    const agentId = parseAgentId(requestedAgentId);
    if (agentId === undefined) {
      return result(
        "UNKNOWN",
        "Live mode requires a numeric uint256 agentId; the contracts do not expose name/address enumeration",
      );
    }
    if (!config.paymentAddress || !config.registryAddress) {
      return result("UNKNOWN", "Set PAYEE_REGISTRY_ADDRESS and PAYMENT_CONTRACT_ADDRESS for live mode");
    }
    try {
      const payee = await readLivePayee(agentId);
      evidence.matchedBy = "agentId";
      evidence.resolved = {
        agentId: agentId.toString(),
        name: `agentId ${agentId}`,
        address: payee.wallet,
        active: payee.allowed,
        trustTier: payee.allowed ? "verified" : "unverified",
      };
      evidence.hashes = { nameHash: payee.nameHash, metadataHash: payee.metadataHash };
      const nameMatches = requestedName ? nameHash(requestedName) === payee.nameHash : true;
      const diff = hashOnlyDiff(requestedName, nameMatches);

      if (lower(payee.wallet) !== lower(payee.registryWallet)) {
        return result(
          "PAYEE_CHANGED",
          "payees(agentId).wallet differs from IdentityRegistry.getAgentWallet(agentId)",
          "unverified",
          diff,
        );
      }
      if (!payee.allowed) {
        return result("NOT_ALLOWLISTED", "PayeeGuard payees(agentId).allowed is false", "unverified", diff);
      }
      if (!nameMatches) {
        return result(
          "NAME_SPOOF",
          "Claimed nameHash does not match payees(agentId).nameHash",
          "verified",
          diff,
        );
      }
      if (requestedAddress && lower(requestedAddress) !== lower(payee.wallet)) {
        return result(
          "NAME_SPOOF",
          "Supplied address is not the wallet from payees(agentId)",
          "verified",
          diff,
        );
      }
      return result(
        "OK",
        "Agent id, nameHash and registry wallet agree; payee is allowlisted",
        "verified",
        diff,
      );
    } catch (error) {
      return result("UNKNOWN", `Registry read failed: ${safeReason(error)}`);
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
    if (!config.demo) {
      return resolveLivePayee(requestedName, requestedAddress, requestedAgentId, evidence);
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

  async function getPolicy(agentIdInput?: string): Promise<Policy> {
    if (config.demo) return { ...demoPolicy(), source: "fixtures/policy.json" };
    // Live limits come from PayeeGuard.sessionOf(agentId, operator), never from a fixture.
    const failClosed: Policy = {
      version: "fail-closed",
      chainId: config.chainId,
      token: "tUSD8",
      tokenDecimals: 6,
      requiredTrustTier: "verified",
      maxAutoApprove: "0",
      requireAllowlist: true,
      rejectPromptInjection: true,
      source: "default (no session for agentId/operator or payment contract missing)",
      maxPerPayment: "0",
      sessionRevoked: true,
    };
    const agentId = parseAgentId(agentIdInput);
    if (agentId === undefined) return failClosed;
    const session = await readLiveSession(agentId);
    if (!session) return failClosed;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const active =
      !session.revoked && session.expiresAt > now && (session.validAfter === 0n || session.validAfter <= now);
    return {
      ...failClosed,
      maxAutoApprove: active ? formatUnits(session.autoApproveLimit, failClosed.tokenDecimals) : "0",
      maxPerPayment: active ? formatUnits(session.maxPerPayment, failClosed.tokenDecimals) : "0",
      sessionExpiresAt: Number(session.expiresAt),
      sessionEpoch: Number(session.epoch),
      sessionRevoked: !active,
      source: `chain:${config.paymentAddress}.sessionOf(${agentId}, ${config.agentOperatorAddress})`,
    };
  }

  async function isAllowlisted(agentId: string, address: Address, policy: Policy): Promise<Allowlist> {
    if (!policy.requireAllowlist) return "ALLOWLISTED";
    if (config.demo) {
      const found = demoIdentities().some(
        (record) => lower(record.address) === lower(address) && record.active && record.trustTier === "verified",
      );
      return found ? "ALLOWLISTED" : "NOT_ALLOWLISTED";
    }
    const id = parseAgentId(agentId);
    if (id === undefined || !config.paymentAddress) return "NOT_ALLOWLISTED";
    try {
      const payee = (await publicClientFor(config).readContract({
        address: config.paymentAddress,
        abi: payeeGuardAbi,
        functionName: "payees",
        args: [id],
      })) as unknown as readonly [Address, Hex, Hex, boolean];
      return payee[3] ? "ALLOWLISTED" : "NOT_ALLOWLISTED";
    } catch {
      return "NOT_ALLOWLISTED";
    }
  }

  async function liveProposeIntent(args: {
    agentId: bigint;
    amount: string;
    nameHash: Hex;
    metadataHash: Hex;
    expiresAt: bigint;
  }): Promise<{ ok: true; intentId: Hex } | { ok: false; reason: string }> {
    if (!config.paymentAddress) return { ok: false, reason: "PAYMENT_CONTRACT_NOT_CONFIGURED" };
    try {
      // The agent session key signs proposals; it never holds tUSD8.
      const wallet = walletClientFor(config, "agent");
      const hash = await wallet.writeContract({
        address: config.paymentAddress,
        abi: payeeGuardAbi,
        functionName: "proposeIntent",
        args: [
          args.agentId,
          parseUnits(args.amount, 6),
          args.nameHash,
          args.metadataHash,
          args.expiresAt,
        ],
      });
      const receipt = await publicClientFor(config).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return { ok: false, reason: "CONTRACT_REVERT" };
      const intentId = intentIdFromReceipt(receipt.logs);
      if (!intentId) return { ok: false, reason: "INTENT_ID_NOT_FOUND" };
      return { ok: true, intentId };
    } catch (error) {
      return { ok: false, reason: safeReason(error) };
    }
  }

  async function proposePayment(input: ProposalInput): Promise<ProposalResult> {
    const policy = await getPolicy(input.agentId);
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
    const allowlist = await isAllowlisted(input.agentId, payee.address, policy);
    if (allowlist === "NOT_ALLOWLISTED") {
      return rejection("OK", "Payee is NOT_ALLOWLISTED by PayeeGuard.payees(agentId)", allowlist);
    }
    if (policy.maxPerPayment !== undefined && Number(input.amount) > Number(policy.maxPerPayment)) {
      return rejection(
        "OK",
        `amount exceeds the session maxPerPayment of ${policy.maxPerPayment} ${policy.token}`,
        allowlist,
      );
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
    let intentId: Hex;
    if (config.demo) {
      intentId = keccak256(
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
    } else {
      const agentId = parseAgentId(input.agentId);
      const hashes = resolution.evidence.hashes;
      if (agentId === undefined || !hashes) {
        return rejection("OK", "Missing uint256 agentId or on-chain identity hashes", allowlist);
      }
      const now = BigInt(Math.floor(Date.now() / 1000));
      const expiresAt =
        policy.sessionExpiresAt !== undefined && BigInt(policy.sessionExpiresAt) > now
          ? BigInt(policy.sessionExpiresAt)
          : now + 3600n;
      const proposed = await liveProposeIntent({
        agentId,
        amount: input.amount,
        nameHash: hashes.nameHash,
        metadataHash: hashes.metadataHash,
        expiresAt,
      });
      if (!proposed.ok) return rejection("OK", proposed.reason, allowlist);
      intentId = proposed.intentId;
    }
    intents.set(intentId, {
      intentId,
      agentId: payee.agentId,
      payeeName: config.demo ? payee.name : undefined,
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
    const allowlist = await isAllowlisted(intent.agentId, intent.payee, intent.policy);
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
    if (!config.demo) {
      // Live-only defense in depth: re-read both payee sources and the intent.
      const agentId = parseAgentId(intent.agentId);
      if (agentId === undefined || !config.paymentAddress || !config.registryAddress) {
        return { ok: false, reason: "UNKNOWN", mode: "live", summary: "Live contracts are not configured" };
      }
      try {
        const client = publicClientFor(config);
        const [payee, registryWallet, onChainIntent] = await Promise.all([
          client.readContract({
            address: config.paymentAddress,
            abi: payeeGuardAbi,
            functionName: "payees",
            args: [agentId],
          }) as Promise<readonly [Address, Hex, Hex, boolean]>,
          client.readContract({
            address: config.registryAddress,
            abi: identityRegistryAbi,
            functionName: "getAgentWallet",
            args: [agentId],
          }) as Promise<Address>,
          client.readContract({
            address: config.paymentAddress,
            abi: payeeGuardAbi,
            functionName: "intents",
            args: [intentId],
          }) as Promise<
            readonly [bigint, Address, bigint, Hex, Hex, bigint, Address, bigint, boolean, boolean]
          >,
        ]);
        const [payeeWallet, , , payeeAllowed] = payee;
        const [onChainAgentId, onChainPayee, , , , , , , onChainApproved, onChainExecuted] = onChainIntent;
        const changed =
          lower(payeeWallet) !== lower(registryWallet) ||
          lower(payeeWallet) !== lower(intent.payee) ||
          onChainAgentId !== agentId ||
          lower(onChainPayee) !== lower(payeeWallet);
        if (changed) {
          return {
            ok: false,
            reason: "PAYEE_CHANGED",
            mode: "live",
            summary: "Stopped: payees(agentId).wallet no longer matches getAgentWallet(agentId)",
          };
        }
        if (!payeeAllowed) {
          return { ok: false, reason: "NOT_ALLOWLISTED", mode: "live", summary: "Stopped: payee is not allowlisted" };
        }
        if (onChainExecuted) {
          return { ok: false, reason: "ALREADY_EXECUTED", mode: "live", summary: "Intent already executed" };
        }
        if (signerRole === "owner" && !onChainApproved) {
          const ownerWallet = walletClientFor(config, "owner");
          const approvalHash = await ownerWallet.writeContract({
            address: config.paymentAddress,
            abi: payeeGuardAbi,
            functionName: "approveIntent",
            args: [intentId],
          });
          const approvalReceipt = await client.waitForTransactionReceipt({ hash: approvalHash });
          if (approvalReceipt.status !== "success") {
            return { ok: false, reason: "NOT_APPROVED", txHash: approvalHash, mode: "live", summary: "Owner approval reverted" };
          }
        }
      } catch (error) {
        return { ok: false, reason: safeReason(error), mode: "live", summary: "Pre-execution checks failed" };
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
      // The session key submits the intent; tryExecuteIntent reports rejection
      // through PaymentRejected instead of reverting with an opaque message.
      const wallet = walletClientFor(config, "agent");
      const hash = await wallet.writeContract({
        address: config.paymentAddress,
        abi: payeeGuardAbi,
        functionName: "tryExecuteIntent",
        args: [intentId],
      });
      const transactionReceipt = await publicClientFor(config).waitForTransactionReceipt({ hash });
      if (transactionReceipt.status !== "success") {
        return { ok: false, reason: "CONTRACT_REVERT", txHash: hash, mode: "live", summary: "Transaction reverted" };
      }
      const rejection = parseEventLogs({ abi: paymentRejectedAbi, logs: transactionReceipt.logs })[0];
      if (rejection) {
        return {
          ok: false,
          reason: decodeRejectReason(rejection.args.reason),
          txHash: hash,
          mode: "live",
          summary: "Payment rejected by PayeeGuard",
        };
      }
      const sent = parseEventLogs({ abi: paymentSentAbi, logs: transactionReceipt.logs })[0];
      if (!sent) {
        return { ok: false, reason: "PAYMENT_SENT_NOT_FOUND", txHash: hash, mode: "live", summary: "No PaymentSent event" };
      }
      const receipt: Receipt = {
        intentId,
        txHash: hash,
        payee: sent.args.payee!,
        amount: formatUnits(sent.args.amount ?? 0n, intent.policy.tokenDecimals),
        timestamp: new Date().toISOString(),
        mode: "live",
      };
      receipts.push(receipt);
      return {
        ok: true,
        txHash: hash,
        mode: "live",
        summary: `Paid ${receipt.amount} ${intent.policy.token} to ${intent.payeeName ?? `agentId ${intent.agentId}`}`,
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
            event: paymentSentAbi[0],
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
