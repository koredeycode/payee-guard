import { readFileSync } from "node:fs";
import type { Address } from "viem";

export type TrustTier = "verified" | "provisional" | "unverified";

export interface IdentityRecord {
  agentId: string;
  name: string;
  type: string;
  address: Address;
  active: boolean;
  trustTier: TrustTier;
  services: string[];
  registrations: Array<{ chainId: number; address: Address; source: string }>;
  /** Volatile: deliberately excluded from metadataHash. */
  fetchedAt?: string;
}

export interface Policy {
  version: string;
  chainId: number;
  token: string;
  tokenDecimals: number;
  requiredTrustTier: TrustTier;
  maxAutoApprove: string;
  requireAllowlist: boolean;
  rejectPromptInjection: boolean;
  source: string;
  /** Live-only limits from PayeeGuard.sessionOf(agentId, operator); absent in demo mode. */
  maxPerPayment?: string;
  sessionExpiresAt?: number;
  sessionEpoch?: number;
  sessionRevoked?: boolean;
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

let identityCache: IdentityRecord[] | undefined;
let policyCache: Policy | undefined;

export function demoIdentities(): IdentityRecord[] {
  identityCache ??= readJson<IdentityRecord[]>(new URL("../fixtures/identities.json", import.meta.url));
  return identityCache;
}

export function demoPolicy(): Policy {
  policyCache ??= readJson<Policy>(new URL("../fixtures/policy.json", import.meta.url));
  return policyCache;
}

/** Fixture names are file names, so keep them to a strict allowlist of characters. */
export function fixtureUrl(name: string): URL {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid fixture name");
  return new URL(`../fixtures/${name}.json`, import.meta.url);
}

export interface RawPaymentRequest {
  id: string;
  description?: string;
  payee: { agentId?: string; name?: string; address?: string };
  amount: string;
  memo: string;
  expected?: { verdict?: string; approval?: string; executed?: boolean };
}

export function readFixture(name: string): RawPaymentRequest {
  return readJson<RawPaymentRequest>(fixtureUrl(name));
}
