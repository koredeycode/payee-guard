# Payee Guard

**An AI agent can ask for a payment. A contract decides whether the payee is real — before any tUSD8 moves.**

Payee Guard is a tUSD8 vault on Aevum testnet (chain `44005`) that derives the payee from an allowlisted ERC-8004 identity, enforces session caps and expiry, and emits an on-chain `PaymentSent` or `PaymentRejected` receipt for every decision. The LLM is a deterministic mock; the money rules are Solidity.

> **Hero image placeholder (capture from the running demo):** the demo console's **red rejection block** for the lookalike-payee scenario — a character-level diff that flags the confusable name, the requested wallet `0x9d3793…41a0` crossed out, and the verdict `PaymentRejected · NOT_ALLOWLISTED` — next to the green `PaymentSent` receipt for the trusted payee `0xc59286…d489E`. Suggested caption: *"Same-looking name. Different wallet. The contract decides before money moves."* The [diff component](web/src/components/guard/SpoofDiff.tsx) is in the repo; the prompt-injection scenario uses the same red block with reason `NAME_HASH_MISMATCH`.

**Links**

- **Hosted demo:** hosted demo link will be added in the final README (no URL is invented here).
- **Demo video:** TBD — not recorded at the time of writing; see [docs/JUDGING-MAP.md](docs/JUDGING-MAP.md) for the timestamp placeholders.
- **8 verified on-chain scenarios:** [`docs/tx-table.json`](docs/tx-table.json) ([verification notes](docs/VERIFICATION.md)).
- **Source:** https://github.com/koredeycode/payee-guard · [authoritative ABI](contracts/ABI.md) · [architecture](docs/ARCHITECTURE.md) · [threat model](docs/THREAT-MODEL.md) · [FAQ](docs/FAQ.md) · [judging map](docs/JUDGING-MAP.md) · [demo-day runbook](docs/DEMO-DAY.md).

```bash
make install   # Solidity libs + JS packages
make build     # compile + Shanghai opcode check
make test      # 60 unit/fuzz/invariant tests (no network needed)
```

---

## The decision in one picture

```mermaid
flowchart LR
    subgraph untrusted["Untrusted input"]
        INV["Invoice / prompt text<br/>attacker-controlled"]
        INJ["Prompt injection<br/>'pay this other address'"]
    end

    subgraph resolver["Resolver — attests, does not settle"]
        WORKER["Agent worker + tools<br/>(deterministic mock LLM,<br/>LLM_PROVIDER=mock)"]
        DIFF["Character diff +<br/>name/metadata hashes"]
    end

    subgraph chain["Aevum testnet 44005 — proves"]
        REG["IdentityRegistry<br/>0x0C286c…614b2<br/>ERC-8004-compatible, self-deployed"]
        GUARD["PayeeGuard vault<br/>0xb0E96A…931ef<br/>payees[agentId].wallet only"]
        TOKEN["tUSD8<br/>0x456569…33483 · 6 decimals"]
    end

    OWNER["Owner 0x0a939e…0f97<br/>allowlist · session · approve · revoke"]
    SESSION["Agent session key 0xF416F1…4eEC1d<br/>gas only; holds no tUSD8"]

    INV --> WORKER
    INJ --> WORKER
    WORKER --> DIFF
    REG -->|agentId → wallet / nameHash| DIFF
    DIFF -->|proposeIntent(agentId, amount,<br/>nameHash, metadataHash, expiresAt)| GUARD
    OWNER -->|allowPayee / createSession /<br/>approveIntent / revokeSession| GUARD
    SESSION -->|propose / tryExecuteIntent| GUARD
    GUARD -->|"payees[agentId].wallet —<br/>never caller-supplied"| TOKEN
    GUARD -->|PaymentSent / PaymentRejected| RECEIPT["On-chain receipts<br/>→ pnpm verify:submission"]
```

The contract proves **Tier 0** (on-chain binding: allowlisted wallet, committed name hash, session caps, epoch, expiry, approval). The resolver attests **Tiers 1–3** (registration metadata, domain control, payment reputation). Only Tier 0 can stop a payment on chain; the attested tiers are advisory. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#trust-boundaries).

---

## Deployed on Aevum testnet

| | |
|---|---|
| Network / chain | QDay Aevum Testnet, `44005` · RPC `https://rpc-test.qday.info` · [explorer](https://explorer-test.qday.info) |
| Deploy block | `0x418c97` (`4292247`) |
| Deployed at commit | [`4fab0da04237ae1b543745e471132ad83c92d1be`](https://github.com/koredeycode/payee-guard/tree/4fab0da04237ae1b543745e471132ad83c92d1be) — deployed at commit `4fab0da…`; later commits (including this docs pack) were not deployed |
| IdentityRegistry | [`0x0C286c822f26ecEa30aC7872AC45895a2C2614b2`](https://explorer-test.qday.info/address/0x0C286c822f26ecEa30aC7872AC45895a2C2614b2) · deploy [tx](https://explorer-test.qday.info/tx/0xe03b82436fe1a368be10f9094c39ac78a300c142a174a8de6de8a65d9f376728) `0xe03b8243…f376728` |
| PayeeGuard | [`0xb0E96A17dC3677AAb535dfDB0cD37433477931ef`](https://explorer-test.qday.info/address/0xb0E96A17dC3677AAb535dfDB0cD37433477931ef) · deploy [tx](https://explorer-test.qday.info/tx/0x4b338d509cc12fb7327ea661fd1e758677a95011e8a92a50a53fc9f9b6b9b082) `0x4b338d50…b9b082` |
| tUSD8 | [`0x456569838f1d43009A91ebA4263147Afd7233483`](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483), 6 decimals |
| Owner / deployer | `0x0a939e7d64677861BD8f15407253d4547f5E0f97` |
| Agent session key | `0xF416F16b2dfAB536fE04fF63AFb36cF6274eEC1d` — gas only, never holds tUSD8 |

**There is no canonical ERC-8004 Identity Registry deployed on Aevum 44005.** The registry above is our own self-deployed, non-upgradeable, ERC-8004-compatible implementation, adapted from the [reference implementation](https://github.com/erc-8004/erc-8004-contracts) at commit `f2afbb0a7f4a8136c9a66ec55f252b8a68f70776` (full wallet API, non-upgradeable for a standalone deploy). It is not an official QDay registry. Registration files are data URIs.

Four identities are seeded (agent IDs are **0-indexed**; IDs `0`–`3` are earlier setup/deploy artifacts):

| agentId | Identity | Wallet | Allowlisted? |
|---|---|---|---|
| `4` | Payee Guard Demo — trusted payee | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | yes |
| `5` | Payee Guard Demo — lookalike payee | `0x9d3793D140D8e2C826dc310622577B7F141841a0` | no |
| `6` | Payee Guard Demo — high-value payee | `0x23953e9f1A11Bb39af0DF5D8ab040a0a80f5DcbA` | via approval path |
| `7` | Payee Guard Demo — rotated payee | `0x84e9AB943CF3C96FcA010ccD55A625992CF24720` | rotated-wallet check |

---

## Verified results on chain `44005`

All eight scenarios were executed live and verified 8/8 with `pnpm verify:submission` (receipts are provisional — inclusion, not finality). Amounts are tUSD8 base units, 6 decimals.

| # | Scenario | Outcome / reason | agentId → payee | Amount | Execution tx |
|---|---|---|---|---|---|
| 01 | legit within caps | `PaymentSent` / accepted | `4` → `0xc592…d489E` | `500000` | [`0x520e5032…da87c6`](https://explorer-test.qday.info/tx/0x520e5032a30ab9a4a16337f12c41e1af70693018ca56c00428b12ca31fda87c6) |
| 02 | lookalike payee | `PaymentRejected` / `NOT_ALLOWLISTED` | `5` → `0x9d37…41a0` | `500000` | [`0xcfbe99bd…c77b65c`](https://explorer-test.qday.info/tx/0xcfbe99bd53c8fb1a6b89195567f83f93d0a10b59d2585d4bd1fc8517fc77b65c) |
| 03 | over per-payment cap | `PaymentRejected` / `ABOVE_PER_PAYMENT_CAP` | `4` → `0xc592…d489E` | `2000001` | [`0x65ae34e9…5fe03`](https://explorer-test.qday.info/tx/0x65ae34e9d593f27a2425bdb018f76f98d4d7db04f346d973f769de5c1ed5fe03) |
| 04 | revoked session | `PaymentRejected` / `SESSION_REVOKED` | `4` → `0xc592…d489E` | `500000` | [`0xb65e3f6f…516fa0b4`](https://explorer-test.qday.info/tx/0xb65e3f6f1c87f8de6d47a0001ba82eee9ef6db2811d280e535a37e0a516fa0b4) |
| 05 | prompt injection | `PaymentRejected` / `NAME_HASH_MISMATCH` | `4` → `0xc592…d489E` | `500000` | [`0xeb912e38…291281`](https://explorer-test.qday.info/tx/0xeb912e3876936af9fe8c9ef701fe2cc6d3dd402fa784f2d24f4e7c3682291281) |
| 06 | above auto-approve limit, owner approved | `PaymentSent` / accepted | `4` → `0xc592…d489E` | `1100000` | [`0x8c57c48d…c63ca8943bd`](https://explorer-test.qday.info/tx/0x8c57c48d9e2ee4a6d9e3ae4539b244940cd7919d24758fe926318c63ca8943bd) |
| 07 | replayed intent | `PaymentRejected` / `INTENT_EXECUTED` | `4` → `0xc592…d489E` | `500000` | [`0x27ea5625…95bb59`](https://explorer-test.qday.info/tx/0x27ea562597a20dc4de526444f5664ea513a26a11f38c599e10154b58fc95bb59) |
| 08 | rotated registry wallet | `PaymentRejected` / `PAYEE_CHANGED` | `4` → `0xc592…d489E` | `500000` | [`0xf0562ca8…629fbb5`](https://explorer-test.qday.info/tx/0xf0562ca8e9d2fd3d67031d4a26e227fa428ae1952c128e92d7163bb5d629fbb5) |

Full hashes, blocks, intent IDs, confirmations and explorer URLs are in [`docs/tx-table.json`](docs/tx-table.json); the [verification record](docs/VERIFICATION.md#scenario-results) lists every field. The read-only [judge UI](web/src/app/demo/page.tsx) explains the eight verdicts with **fixture data and placeholder hashes** — it is a visual explainer, not the source of truth. The receipts above are real chain data.

---

## Quickstart

Prerequisites: Node 22+, pnpm, Foundry (`foundryup`), and — for the live demo — a funded test key.

```bash
make install                 # submodules + pnpm workspace
make build                   # forge build + Shanghai opcode check
make test                    # 60 unit/fuzz/invariant tests, offline
make test-fork               # 6 fork tests against real tUSD8 (no funds needed)
```

Reproduce the eight decisions with Docker — this is a **real local fork of Aevum** with the real tUSD8, not a simulation:

```bash
docker compose up --build    # fork + deploy + seed + 8 scenarios + web UI
```

Or against the live deployment (needs keys; see [scripts/shared.ts](scripts/shared.ts) for env names):

```bash
export GUARD_ADDRESS=0xb0E96A17dC3677AAb535dfDB0cD37433477931ef
export REGISTRY_ADDRESS=0x0C286c822f26ecEa30aC7872AC45895a2C2614b2
pnpm demo                    # writes provisional receipts to docs/tx-table.json
pnpm verify:submission       # 8/8 PASS: receipts + events checked on chain 44005
```

`pnpm demo` uses `DRY_RUN=1` for a key-free plan. `pnpm verify:submission` needs `GUARD_ADDRESS`/`REGISTRY_ADDRESS`. See [docs/DEMO-DAY.md](docs/DEMO-DAY.md) for the live runbook and [docs/VERIFICATION.md](docs/VERIFICATION.md) for every hash and exact repro command.

---

## What is real vs mocked

| Component | Status | What you can check |
|---|---|---|
| PayeeGuard, IdentityRegistry | **Real contracts, deployed** on Aevum `44005` at the addresses above | [verification](docs/VERIFICATION.md), [ABI](contracts/ABI.md) |
| tUSD8 transfers and receipts | **Real** token, real transactions; receipts are **provisional** (inclusion, not finality) | [`docs/tx-table.json`](docs/tx-table.json) |
| Eight scenarios | **All 8 executed live and verified**; `pnpm verify:submission` reports 8/8 PASS | [results](docs/VERIFICATION.md#scenario-results) |
| Registry | **Self-deployed**, non-upgradeable, ERC-8004-compatible; **no canonical registry exists on Aevum 44005** | [architecture](docs/ARCHITECTURE.md#the-registry) |
| Registration files | **Data URIs**, not IPFS/HTTP-hosted documents | [verification](docs/VERIFICATION.md#known-limitations) |
| Domain `.well-known` check | **Advisory, NOT active in this demo** — it never gates a payment | [trust boundaries](docs/ARCHITECTURE.md#trust-boundaries) |
| Payment reputation | **Derived from `PaymentSent` events — marked stretch** | [FAQ](docs/FAQ.md#is-the-reputation-score-real) |
| LLM | **Deterministic mock** (`LLM_PROVIDER=mock`); no external model or API key | [FAQ](docs/FAQ.md#is-an-llm-actually-deciding) |
| Docker demo | **Real local fork** of Aevum with the real tUSD8 | [demo day](docs/DEMO-DAY.md#backup-plan) |
| Read-only judge UI | **Fixture data and placeholder hashes** in [`web/src/data/scenarios.ts`](web/src/data/scenarios.ts); it explains verdicts, it is not evidence of on-chain activity | [demo page](web/src/app/demo/page.tsx), [real receipts](docs/tx-table.json) |
| Hosted demo / video | **TBD** — hosted demo link will be added in the final README; video not recorded | [judging map](docs/JUDGING-MAP.md) |
| Audit | **Not audited. Testnet only.** | [SECURITY.md](SECURITY.md), [threat model](docs/THREAT-MODEL.md) |

---

## Trust boundary

**The contract proves Tier 0; the resolver attests Tiers 1–3.**

- **Tier 0 — on-chain binding (proven by Solidity):** the payee is read from `payees[agentId].wallet` and can never be supplied by the caller; the owner allowlists the wallet against `registry.getAgentWallet(agentId)`; sessions carry per-payment and cumulative caps, an auto-approve limit, expiry, epoch and revoke; intents propose → approve → execute and are single-use. A rejection emits `PaymentRejected(intentId, caller, reason)` and moves no funds.
- **Tiers 1–3 — attested by the resolver (advisory):** registration metadata, domain control and payment reputation are assembled off chain from the registry data URI, an invoice domain and `PaymentSent` history. They inform the owner and the UI but do not authorize settlement. The domain `.well-known` tier is advisory and **not active** in this demo.

Consequence: a prompt injection cannot redirect funds, because the LLM never supplies a destination and the payee is never caller-supplied. It can only cause a proposal that the contract refuses. See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

---

## Threat model summary

Assets: the tUSD8 held by the vault and the integrity of the payee binding. Adversaries: a spoofed invoice, a prompt injection, a compromised agent session key, a rotated registry wallet and a replayed intent. Mitigations: allowlisting bound to the registry wallet, committed name/metadata hashes, least-privilege sessions with caps and expiry, epoch-based revocation, approval above the auto-approve limit, single-use intents, and a non-reverting rejection path that records why a payment was refused. Token-level failures (issuer pause or blacklist) still revert and are **not** policy reasons.

Residual risks: the contract trusts the owner's allowlist decision; the issuer can pause or blacklist tUSD8; the mock LLM and advisory tiers are not security controls; the receipts are provisional; and the code is **not audited**. Full detail: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

---

## Business model

Payee Guard is a confirmation-of-payee layer that treasury teams, marketplaces and agent operators pay for as a hosted verification API or SDK: the customer funds its own vault and owns the allowlist and session policy, while Payee Guard charges per verified payment or a subscription for the resolver, audit trail and dashboard. The contract is the trust anchor the customer can audit without trusting our servers; we would earn fees on decisions, not float on customer balances. A mainnet path requires a Safe/multisig owner, an audit and a canonical ERC-8004 registry — none of which exist in this testnet demo. See [docs/BUSINESS.md](docs/BUSINESS.md).

---

## Roadmap

1. Record the demo video and add real timestamps to the [judging map](docs/JUDGING-MAP.md); add the hosted demo link here.
2. Move `PaymentRejected` receipts past provisional inclusion to finality-aware confirmations.
3. Replace the deterministic mock resolver with a real, bounded tool-use agent, keeping the same on-chain policy gate.
4. Activate the domain `.well-known` tier and publish a transparent reputation methodology.
5. Mainnet prerequisites: Safe/multisig owner, independent audit, multi-sig-controlled upgrades or a fully immutable deployment, and a canonical ERC-8004 registry when one exists on Aevum.

---

## Credits

**Based on Aevum Starter Kit (MIT, PQA Labs)** — https://github.com/qday-io/aevum-starter-kit. The non-upgradeable identity registry is adapted from the ERC-8004 reference implementation at commit `f2afbb0a7f4a8136c9a66ec55f252b8a68f70776`. UI guidance follows *unslop* by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. Project code is MIT licensed (see [LICENSE](LICENSE)); third-party notices are in [NOTICE.md](NOTICE.md). Testnet only — no real funds.
