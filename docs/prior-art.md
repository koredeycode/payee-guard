# Prior art and honest differentiation

We are aware of other Aevum Builder Challenge projects in the same space. This page states the overlap plainly and points to checkable differences; it does not claim those projects are worse, or that we invented their ideas.

## `LBCron/aevum-tusd8-paystream`

Public DoraHacks build: [Aevum tUSD8 PayStream](https://dorahacks.io/build/51205) · source: https://github.com/LBCron/aevum-tusd8-paystream.

**Honest overlap.** Both projects target tUSD8 on Aevum testnet `44005`, both use ERC-8004-style identity-to-address verification for Confirmation of Payee, and both describe scoped AI agent capabilities with per-transaction caps. PayStream publicly describes a `ERC8004PayeeRegistry.sol` for identity-to-address verification, scoped agent session keys with per-transaction and rolling spend caps, plus x402 resource receipt hashes. Confirmation of Payee and agent payments are not novel ideas in this challenge — we do not claim they are.

**Where Payee Guard differs, and what you can check.**

| Axis | Payee Guard | Evidence |
|---|---|---|
| Scope | One decision, end to end: may this exact amount go to this exact payee? PayStream is a broader suite (streaming payroll, invoice factoring, milestone escrow, scoped agent keys). | [Architecture](ARCHITECTURE.md), [`PayeeGuard.sol`](../contracts/src/PayeeGuard.sol) |
| Recipient source | `proposeIntent` has **no payee argument**; the vault derives the payee from `payees[agentId].wallet`. | [ABI](../contracts/ABI.md#1-payeeguard) |
| Refusals as receipts | `tryExecuteIntent` emits `PaymentRejected(intentId, caller, reason)` with no funds moved; 16 reason codes; 6 of 8 live scenarios are explicit policy rejections. | [ABI](../contracts/ABI.md#5-policy-reason-codes-all-16-exact-bytes32-values), [tx table](tx-table.json) |
| Live evidence | Eight named scenarios executed on chain `44005`, all verified by `pnpm verify:submission` (8/8 PASS, provisional receipts). | [VERIFICATION.md](VERIFICATION.md#scenario-results) |
| Registry provenance | Self-deployed, non-upgradeable, 0-indexed ERC-8004-compatible registry adapted from reference commit `f2afbb0`; **no canonical registry exists on Aevum 44005**; registration files are data URIs. | [ARCHITECTURE.md](ARCHITECTURE.md#the-registry) |
| Model | Deterministic mock (`LLM_PROVIDER=mock`); no external model, so results are reproducible. | [FAQ](FAQ.md#is-an-llm-actually-deciding) |
| Reproducibility | `docker compose up --build` runs a real local fork with the real tUSD8 and no private keys; `make build && make test` is offline. | [DEMO-DAY.md](DEMO-DAY.md#backup-plan), [VERIFICATION.md](VERIFICATION.md#reproduce-it) |

**What we do not claim:** that we were first, that our registry is official, that our LLM is a production model, that receipts are final, or that any of this is audited or mainnet-ready. PayStream's streaming, factoring and escrow features are outside our scope entirely; we did not copy code from it.

## Starter kit and other templates

The [Aevum Starter Kit (MIT, PQA Labs)](https://github.com/qday-io/aevum-starter-kit) supplied the Foundry/web plumbing, chain config and CI. Templates are explicitly allowed by the challenge when licensing permits; we keep the license and credit (see [NOTICE.md](../NOTICE.md)). Other challenge submissions may cover invoicing or streaming; this project deliberately narrows to the "is this payee real?" decision rather than competing on the number of features.

## Why this differentiation matters for judging

The [judging map](JUDGING-MAP.md) maps each official criterion to evidence in this repository. The strongest checkable claims are the deployed addresses, the exact deployed commit, the eight on-chain receipts with explicit reason codes, and the separation between what the contract proves and what the resolver merely attests.
