# Payee Guard — Demo Day runbook

Official format: the top five projects present a **3–5 minute live demo** on a video call. Winners are announced 15 Dec 2026, 06:00 UTC (14:00 HKT); judging runs 12–14 Dec. Full rules: [DoraHacks](https://dorahacks.io/hackathon/qday) and [challenge page](https://qday.io/builder-challenge).

---

## Links to have open (do not type addresses live)

| What | Link |
|---|---|
| Demo / UI | **Placeholder** — hosted demo link will be added in the final README after the Vercel deploy |
| Video (if recorded) | TBD — timestamps in [JUDGING-MAP.md](JUDGING-MAP.md) are TBD |
| Verified receipts | [`docs/tx-table.json`](tx-table.json) |
| Verification record | [VERIFICATION.md](VERIFICATION.md) |
| Architecture + sequences | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Source and ABI | [repo](https://github.com/koredeycode/payee-guard) · [contracts/ABI.md](../contracts/ABI.md) |
| Explorer | https://explorer-test.qday.info · RPC `https://rpc-test.qday.info` |
| PayeeGuard | [`0xb0E96A17dC3677AAb535dfDB0cD37433477931ef`](https://explorer-test.qday.info/address/0xb0E96A17dC3677AAb535dfDB0cD37433477931ef) |
| IdentityRegistry | [`0x0C286c822f26ecEa30aC7872AC45895a2C2614b2`](https://explorer-test.qday.info/address/0x0C286c822f26ecEa30aC7872AC45895a2C2614b2) |

---

## Preflight (15 minutes before)

- [ ] `pnpm verify:submission` with `GUARD_ADDRESS`/`REGISTRY_ADDRESS` set → **8/8 PASS** (remind: provisional receipts, inclusion not finality).
- [ ] Open the demo UI, or have `docker compose up --build` already warm as the backup (real local fork, real tUSD8, no keys).
- [ ] Open [`docs/tx-table.json`](tx-table.json) and one explorer receipt in a second tab.
- [ ] Confirm screen share shows the red rejection block and the diff panel legibly.
- [ ] No keys, `.env` files or private-key text anywhere on screen or in the repo.
- [ ] Say the framing line once: *"The LLM proposes; the contract decides. There is no canonical ERC-8004 registry on Aevum 44005 — ours is self-deployed."*

---

## Four-minute script

| Time | Action | Say |
|---|---|---|
| 0:00–0:30 | Show the hero: trusted payee receipt next to the red spoof block. | "An agent can be told to pay the wrong 'Northwind'. The name looks right; the wallet isn't. The contract decides before money moves." |
| 0:30–1:15 | Open the [happy-path sequence](ARCHITECTURE.md#happy-path--scenario-01-paymentsent) or run scenario 01 on the fork. Show [receipt 01](tx-table.json). | "Owner allowlists agent 4's wallet against the registry, creates a bounded session; the agent proposes, the vault pays from `payees[agentId].wallet` — never a caller-supplied address." |
| 1:15–2:15 | Run/show scenario 02 (lookalike, `NOT_ALLOWLISTED`) and scenario 05 (prompt injection, `NAME_HASH_MISMATCH`). | "Two different attacks, same outcome: `PaymentRejected`, no funds moved. The diff flags confusable characters; the mock LLM has no pay tool and no key." |
| 2:15–3:00 | Run/show scenario 06 (`APPROVAL_REQUIRED` → owner approves → `PaymentSent`) and scenario 04 (`SESSION_REVOKED`). | "Above the auto-approve limit a human must approve; the owner path still checks everything except the two caps. Revocation takes effect at execution time." |
| 3:00–3:30 | Show scenario 07 (`INTENT_EXECUTED`) and 08 (`PAYEE_CHANGED`). | "Intents are single-use, and rotating the registry wallet after approval stops the payment." |
| 3:30–4:00 | Show [tx-table.json](tx-table.json) and the [trust boundary](../README.md#trust-boundary). Close with the honest limits. | "8/8 verified on Aevum 44005, provisional receipts. Not audited, testnet only, no canonical registry, deterministic mock LLM, domain `.well-known` advisory and not active, reputation derived from `PaymentSent` — marked stretch." |

If asked for more time, extend with the [architecture diagrams](ARCHITECTURE.md) and [threat model](THREAT-MODEL.md), not with more scenario runs.

---

## Backup plan

| Failure | Fallback |
|---|---|
| Hosted demo unavailable | Run `docker compose up --build` (real local fork, real tUSD8, chain `440050`) and state clearly that it is a fork, not the live chain |
| Live RPC `rpc-test.qday.info` slow or down | Do not wait: open the already-recorded receipts in [`docs/tx-table.json`](tx-table.json) and the explorer links; explain receipts are provisional |
| Screen-share or audio fails | Switch to phone/hotspot and share only the tx table tab; talk through the [30-second judge path](JUDGING-MAP.md#30-second-judge-path) |
| Fork demo fails mid-run | Re-run `docker compose up --build` from scratch; it deploys and seeds deterministically with no private keys |
| Asked for a mainnet claim | Say plainly: not audited, testnet only, issuer can pause/blacklist tUSD8, allowlisting is the owner's trust decision, and mainnet needs a Safe/multisig owner |

---

## Likely Q&A

- **Is the registry official?** No canonical ERC-8004 registry exists on Aevum 44005; ours is self-deployed, non-upgradeable and adapted from reference commit `f2afbb0`. See [FAQ](FAQ.md#is-there-a-canonical-erc-8004-registry-on-aevum-44005).
- **Is the AI real?** `LLM_PROVIDER=mock`, deterministic. The security property does not depend on the model. See [FAQ](FAQ.md#is-an-llm-actually-deciding).
- **Does `.well-known` prove domain control?** Not here — advisory and NOT active in this demo.
- **Are the payments final?** No: receipts prove inclusion, not finality. See [VERIFICATION.md](VERIFICATION.md#known-limitations).
- **Can the agent steal the funds?** It holds no tUSD8; it is bounded by caps, expiry, epoch and revoke, and cannot choose the payee. See [THREAT-MODEL.md](THREAT-MODEL.md#adversaries-and-mitigations).
- **What if tUSD8 is paused or blacklists us?** The token-level failure reverts and is not a policy reason; it is visible as a failed transaction.
- **Why not just use a template checkout?** This is a confirmation-of-payee decision with an on-chain rejection trail; see [prior art](prior-art.md) for an honest comparison.
- **How fast can I verify?** `make build && make test` offline, or `pnpm verify:submission` with the two addresses set — 8/8 PASS.
