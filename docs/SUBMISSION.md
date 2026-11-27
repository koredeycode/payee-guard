# Payee Guard — DoraHacks submission pack

**Title:** Payee Guard — confirmation of payee for agentic stablecoin payments
**One-line pitch:** An AI agent can ask for a payment; a contract decides whether the payee is real — before any tUSD8 moves.
**Track:** Confirmation of Payee (primary); Native AI Assistants (secondary).
**Submit at:** https://dorahacks.io/hackathon/qday · details: https://qday.io/builder-challenge

---

## Build description (write-up, ~150 words)

> Payee Guard stops an AI agent from paying the wrong "trusted" payee. A lookalike name or a prompt injection can send funds to the wrong wallet. We put the final decision in a Solidity vault on Aevum testnet: the owner allowlists an ERC-8004-compatible identity, commits the payee's name hash, and creates a bounded session. The agent proposes a payment; the contract derives the recipient from its own allowlist, never from the request, checks caps, expiry, approval and revocation, then either transfers tUSD8 from the vault or emits `PaymentRejected` with a reason code and no funds moved. Eight scenarios were executed on chain `44005` and verified 8/8, covering a lookalike payee, prompt injection, cap breach, revoked session, owner approval, replay and wallet rotation. The resolver uses a deterministic mock LLM; the contract enforces the rules. No canonical ERC-8004 registry exists on Aevum 44005, so ours is self-deployed and non-upgradeable. Not audited; testnet only.

---

## Links and identifiers

| Item | Value |
|---|---|
| Public repo | https://github.com/koredeycode/payee-guard (MIT) |
| Deployed at commit | [`4fab0da04237ae1b543745e471132ad83c92d1be`](https://github.com/koredeycode/payee-guard/tree/4fab0da04237ae1b543745e471132ad83c92d1be) |
| Network / block | Aevum testnet `44005` · `0x418c97` (`4292247`) |
| PayeeGuard | `0xb0E96A17dC3677AAb535dfDB0cD37433477931ef` |
| IdentityRegistry | `0x0C286c822f26ecEa30aC7872AC45895a2C2614b2` |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals) |
| 8 receipts | [`docs/tx-table.json`](tx-table.json) · [verification record](VERIFICATION.md) |
| Hosted demo | **Placeholder** — hosted demo link will be added in the final README after the Vercel deploy |
| Demo video | TBD — [timestamp placeholders](JUDGING-MAP.md) |
| Docs | [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Threat model](THREAT-MODEL.md) · [FAQ](FAQ.md) · [Business](BUSINESS.md) |

## Receipt highlights (real, verified on chain `44005`)

| Scenario | agentId → payee | Amount (base units) | Reason | Explorer |
|---|---|---|---|---|
| 01 legit | `4` → `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `PaymentSent` / accepted | [`0x520e5032…da87c6`](https://explorer-test.qday.info/tx/0x520e5032a30ab9a4a16337f12c41e1af70693018ca56c00428b12ca31fda87c6) |
| 02 lookalike | `5` → `0x9d3793D140D8e2C826dc310622577B7F141841a0` | `500000` | `NOT_ALLOWLISTED` | [`0xcfbe99bd…c77b65c`](https://explorer-test.qday.info/tx/0xcfbe99bd53c8fb1a6b89195567f83f93d0a10b59d2585d4bd1fc8517fc77b65c) |
| 05 injection | `4` → `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `NAME_HASH_MISMATCH` | [`0xeb912e38…291281`](https://explorer-test.qday.info/tx/0xeb912e3876936af9fe8c9ef701fe2cc6d3dd402fa784f2d24f4e7c3682291281) |
| 06 approved | `4` → `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `1100000` | `PaymentSent` / accepted | [`0x8c57c48d…c63ca8943bd`](https://explorer-test.qday.info/tx/0x8c57c48d9e2ee4a6d9e3ae4539b244940cd7919d24758fe926318c63ca8943bd) |
| 07 replay | `4` → `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `INTENT_EXECUTED` | [`0x27ea5625…95bb59`](https://explorer-test.qday.info/tx/0x27ea562597a20dc4de526444f5664ea513a26a11f38c599e10154b58fc95bb59) |
| 08 rotation | `4` → `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `PAYEE_CHANGED` | [`0xf0562ca8…629fbb5`](https://explorer-test.qday.info/tx/0xf0562ca8e9d2fd3d67031d4a26e227fa428ae1952c128e92d7163bb5d629fbb5) |

Blocks `4296125`, `4296134`, `4296158`, `4296171`, `4296174`, `4296182` respectively; the other two verified scenarios (03 `ABOVE_PER_PAYMENT_CAP`, 04 `SESSION_REVOKED`) and all eight `intentId` values are in [`docs/tx-table.json`](tx-table.json).

## Real vs mocked

- **Real:** contracts, identities and tUSD8 transfers on Aevum `44005`; eight verified executions; a Docker demo that is a real local fork with the real tUSD8; 60 unit/fuzz/invariant + 6 fork tests; Shanghai opcode check.
- **Mocked / advisory:** deterministic mock LLM (`LLM_PROVIDER=mock`); domain `.well-known` tier advisory and NOT active in this demo; reputation derived from `PaymentSent` events — marked stretch; registration files are data URIs; receipts are provisional (inclusion, not finality).
- **Not claimed:** no canonical ERC-8004 registry exists on Aevum 44005; no audit, no mainnet, no finality claim, no hosted URL or video yet.

## 30-second judge path

1. Open [`docs/tx-table.json`](tx-table.json) and click a `PaymentSent` (01 or 06) and a `PaymentRejected` (02–05, 07, 08) link on the explorer.
2. Read the [trust boundary](../README.md#trust-boundary): the contract proves Tier 0; the resolver attests Tiers 1–3.
3. Reproduce offline with `make build && make test`, or run `docker compose up --build` for the real local fork.

## Pre-submit checklist

- [ ] Repo public and readable logged out; MIT license and [NOTICE](../NOTICE.md) credit the starter kit, ERC-8004 reference and unslop.
- [ ] No private keys, `.env` files or API keys in the repo or history.
- [ ] Demo link works without login once added; video link and timestamps replaced with real values.
- [ ] `pnpm verify:submission` re-run on submission day → 8/8 PASS with the provisional-receipt caveat stated.
