# Payee Guard — verification record

Every claim below is checkable against Aevum testnet (`44005`) or this repository. Nothing here is a finality claim.

---

## Deployment

| Item | Value |
|---|---|
| Repository | https://github.com/koredeycode/payee-guard (public, MIT) |
| Deployed at commit | [`4fab0da04237ae1b543745e471132ad83c92d1be`](https://github.com/koredeycode/payee-guard/tree/4fab0da04237ae1b543745e471132ad83c92d1be) — *deployed at commit `4fab0da…`*; later commits, including this documentation pack, were not deployed |
| Network / chain ID | QDay Aevum Testnet / `44005` |
| RPC / explorer | `https://rpc-test.qday.info` / https://explorer-test.qday.info |
| Deploy block | `0x418c97` = `4292247` |
| IdentityRegistry | [`0x0C286c822f26ecEa30aC7872AC45895a2C2614b2`](https://explorer-test.qday.info/address/0x0C286c822f26ecEa30aC7872AC45895a2C2614b2) · deploy tx [`0xe03b82436fe1a368be10f9094c39ac78a300c142a174a8de6de8a65d9f376728`](https://explorer-test.qday.info/tx/0xe03b82436fe1a368be10f9094c39ac78a300c142a174a8de6de8a65d9f376728) |
| PayeeGuard | [`0xb0E96A17dC3677AAb535dfDB0cD37433477931ef`](https://explorer-test.qday.info/address/0xb0E96A17dC3677AAb535dfDB0cD37433477931ef) · deploy tx [`0x4b338d509cc12fb7327ea661fd1e758677a95011e8a92a50a53fc9f9b6b9b082`](https://explorer-test.qday.info/tx/0x4b338d509cc12fb7327ea661fd1e758677a95011e8a92a50a53fc9f9b6b9b082) |
| tUSD8 | [`0x456569838f1d43009A91ebA4263147Afd7233483`](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483), 6 decimals |
| Owner / deployer | `0x0a939e7d64677861BD8f15407253d4547f5E0f97` |
| Agent session key | `0xF416F16b2dfAB536fE04fF63AFb36cF6274eEC1d` (gas only; holds no tUSD8) |

**Compiler settings** ([`contracts/foundry.toml`](../contracts/foundry.toml)): Solidity `0.8.24`, EVM version `shanghai`, optimizer enabled with `200` runs. The Shanghai opcode check (`make build` → `tools/check-shanghai.mjs`) is green; CI runs from the starter kit and runs `pnpm build` too.

**Registry provenance:** self-deployed, non-upgradeable, ERC-8004-compatible Identity Registry adapted from the [ERC-8004 reference implementation](https://github.com/erc-8004/erc-8004-contracts) at commit `f2afbb0a7f4a8136c9a66ec55f252b8a68f70776` (full wallet API, non-upgradeable for a standalone deploy). **No canonical ERC-8004 registry exists on Aevum 44005.** Agent IDs are 0-indexed: `0`–`3` are earlier setup/deploy artifacts; the four seeded payees are:

| agentId | Wallet | Role in the demo |
|---|---|---|
| `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | trusted payee, allowlisted |
| `5` | `0x9d3793D140D8e2C826dc310622577B7F141841a0` | lookalike, not allowlisted |
| `6` | `0x23953e9f1A11Bb39af0DF5D8ab040a0a80f5DcbA` | high-value, owner-approval path |
| `7` | `0x84e9AB943CF3C96FcA010ccD55A625992CF24720` | rotated-wallet check |

---

## Scenario results

All eight scenarios were executed live on chain `44005` and checked by `pnpm verify:submission`: **8/8 PASS**. Receipts recorded in [`docs/tx-table.json`](tx-table.json) are **PROVISIONAL** — they prove inclusion, not finality. Amounts are in tUSD8 base units (6 decimals) exactly as recorded.

| # | Scenario | Outcome | Event / reason | Block | Execution tx |
|---|---|---|---|---|---|
| 01 | `01-legit-within-caps` | SENT | `PaymentSent` / accepted | `4296125` | [`0x520e5032…da87c6`](https://explorer-test.qday.info/tx/0x520e5032a30ab9a4a16337f12c41e1af70693018ca56c00428b12ca31fda87c6) |
| 02 | `02-lookalike-payee` | REJECTED | `PaymentRejected` / `NOT_ALLOWLISTED` | `4296134` | [`0xcfbe99bd…c77b65c`](https://explorer-test.qday.info/tx/0xcfbe99bd53c8fb1a6b89195567f83f93d0a10b59d2585d4bd1fc8517fc77b65c) |
| 03 | `03-over-per-payment-cap` | REJECTED | `PaymentRejected` / `ABOVE_PER_PAYMENT_CAP` | `4296141` | [`0x65ae34e9…5fe03`](https://explorer-test.qday.info/tx/0x65ae34e9d593f27a2425bdb018f76f98d4d7db04f346d973f769de5c1ed5fe03) |
| 04 | `04-revoked-session` | REJECTED | `PaymentRejected` / `SESSION_REVOKED` | `4296148` | [`0xb65e3f6f…516fa0b4`](https://explorer-test.qday.info/tx/0xb65e3f6f1c87f8de6d47a0001ba82eee9ef6db2811d280e535a37e0a516fa0b4) |
| 05 | `05-prompt-injection` | REJECTED | `PaymentRejected` / `NAME_HASH_MISMATCH` | `4296158` | [`0xeb912e38…291281`](https://explorer-test.qday.info/tx/0xeb912e3876936af9fe8c9ef701fe2cc6d3dd402fa784f2d24f4e7c3682291281) |
| 06 | `06-above-auto-approve-limit` | SENT after owner approval | `PaymentSent` / accepted | `4296171` | [`0x8c57c48d…3ca8943bd`](https://explorer-test.qday.info/tx/0x8c57c48d9e2ee4a6d9e3ae4539b244940cd7919d24758fe926318c63ca8943bd) |
| 07 | `07-replay-intent` | REJECTED | `PaymentRejected` / `INTENT_EXECUTED` | `4296174` | [`0x27ea5625…95bb59`](https://explorer-test.qday.info/tx/0x27ea562597a20dc4de526444f5664ea513a26a11f38c599e10154b58fc95bb59) |
| 08 | `08-rotate-agent-wallet` | REJECTED | `PaymentRejected` / `PAYEE_CHANGED` | `4296182` | [`0xf0562ca8…629fbb5`](https://explorer-test.qday.info/tx/0xf0562ca8e9d2fd3d67031d4a26e227fa428ae1952c128e92d7163bb5d629fbb5) |

Every field recorded in [`docs/tx-table.json`](tx-table.json) — request details as executed on chain `44005`:

| Scenario | agentId | Payee | Amount (base units) | `intentId` | Confirmations at verification |
|---|---|---|---|---|---|
| 01 | `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `0x355118147df0fe207d3b45a9b05a4ed66b5968ba6653ac4305e587539c442a76` | 2 |
| 02 | `5` | `0x9d3793D140D8e2C826dc310622577B7F141841a0` | `500000` | `0xe977d166bd15716c013fa86e512d844002af996679aee0427c8524bab3c18b0a` | 0 |
| 03 | `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `2000001` | `0x141fc28add1d0c67370d7f3d8530040b482d8938904b9e29c45acf6f3b9b71d7` | 1 |
| 04 | `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `0xd2268241201ee636cf6da0db43b68692341edc1daff6f734a22eaecdabe4eb06` | 0 |
| 05 | `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `0x381c10d48a1db06ac31e3350c8ce3cf6fd7377fc1cfe3d0f4a2c3009d0debcdc` | 0 |
| 06 | `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `1100000` | `0xbe41c77b7e9861025cb48cb39d0fe372967006d66c85b3bed1974ae5a70833ee` | 2 |
| 07 | `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `0x355118147df0fe207d3b45a9b05a4ed66b5968ba6653ac4305e587539c442a76` | 0 |
| 08 | `4` | `0xc592867b6Cf7fB93AF1E21a4EE1423BB4efd489E` | `500000` | `0x7a261884d3a5e1c8d30a971ac11283d69a9964c75423d59d8028e626bf9afc95` | 1 |

Scenario 07 deliberately reuses scenario 01's `intentId` to prove single-use behaviour. `paymentRef` on `PaymentSent` is the same `intentId`. `generatedAt` in the table is `2026-11-27T22:57:36.871Z`; all entries are `network: live`, `chainId: 44005`, `status: success`, `finality: provisional`.

**Tests:** `make test` runs 60 unit/fuzz/invariant tests; `make test-fork` runs 6 fork tests against the real tUSD8; the Shanghai opcode check is green. CI runs from the starter kit.

---

## Reproduce it

```bash
# Source and offline checks (no keys, no funds)
make install
make build                 # forge build + Shanghai opcode check
make test                  # 60 unit/fuzz/invariant tests
make test-fork             # 6 fork tests, real tUSD8, no funds needed

# Full local reproduction: anvil fork of Aevum + deploy + seed + 8 scenarios + web
docker compose up --build  # real local fork (chain 440050), real tUSD8, no private keys

# Live chain (44005): needs OWNER_PRIVATE_KEY, AGENT_PRIVATE_KEY and
# PAYEE_1_ADDRESS … PAYEE_4_ADDRESS from the environment; never commit them.
export GUARD_ADDRESS=0xb0E96A17dC3677AAb535dfDB0cD37433477931ef
export REGISTRY_ADDRESS=0x0C286c822f26ecEa30aC7872AC45895a2C2614b2
pnpm demo                  # DRY_RUN=1 prints a key-free plan instead
pnpm verify:submission     # needs GUARD_ADDRESS/REGISTRY_ADDRESS; reports 8/8 PASS
pnpm read:events           # guard logs in 1,000-block chunks (Aevum RPC limit)
```

`pnpm demo` writes provisional receipts to `docs/tx-table.json`. `pnpm verify:submission` checks each receipt, event and reason against chain `44005` and prints `8/8 entries verified … Receipts are PROVISIONAL, not final.`

---

## Known limitations

- **No finality claim.** A receipt proves inclusion in a block, not finality. Confirmations recorded in the table are a snapshot at verification time.
- **Explorer verification is unavailable.** The Aevum testnet explorer's contract verifier is not working, so `forge verify-contract` fails for now. Source identity is established by the deploy transactions, the exact deployed commit and this documentation.
- **RPC constraints.** `eth_getLogs` fails over ranges larger than 1,000 blocks; use the chunked reader. HTTPS only — no WebSocket RPC. Contracts must be Shanghai-compatible (`MCOPY`, `TSTORE`/`TLOAD` and blob opcodes are unsupported).
- **Registry data.** Registration files are data URIs, not IPFS/HTTP documents. The domain `.well-known` tier is advisory and **NOT active** in this demo. Reputation is derived from `PaymentSent` events — **marked stretch**.
- **Mock LLM.** `LLM_PROVIDER=mock`, a deterministic mock. No external model or API key is involved in any of the eight scenarios.
- **Not audited; testnet only.** The issuer can pause or blacklist tUSD8; allowlisting is the owner's trust decision; use a Safe/multisig owner on mainnet. See [THREAT-MODEL.md](THREAT-MODEL.md) and [SECURITY.md](../SECURITY.md).
- **Hosted demo / video.** No URL is invented: hosted demo link will be added in the final README, and video timestamps remain TBD in [JUDGING-MAP.md](JUDGING-MAP.md).
