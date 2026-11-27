# Payee Guard — FAQ

### What does Payee Guard do in one sentence?

It is a tUSD8 vault on Aevum testnet that pays only the payee an owner allowlisted, and emits an on-chain `PaymentSent` or `PaymentRejected` receipt for every decision. The payee comes from `payees[agentId].wallet`, never from the caller's request.

### What problem does it solve?

An AI agent asked to pay an invoice can be fooled by a lookalike name, a spoofed domain or a prompt injection telling it to pay another address. Payee Guard moves the last decision into a contract that checks the allowlisted wallet, committed name hash and session policy before any token moves.

### Is this deployed on Aevum testnet?

Yes — chain `44005`, PayeeGuard at `0xb0E96A17dC3677AAb535dfDB0cD37433477931ef`, IdentityRegistry at `0x0C286c822f26ecEa30aC7872AC45895a2C2614b2`, using real tUSD8 at `0x456569838f1d43009A91ebA4263147Afd7233483`. It was deployed at commit `4fab0da04237ae1b543745e471132ad83c92d1be` in block `0x418c97` (`4292247`); later commits were not deployed. See [VERIFICATION.md](VERIFICATION.md#deployment).

### Is there a canonical ERC-8004 registry on Aevum 44005?

No canonical registry exists on Aevum 44005. Our registry is a self-deployed, non-upgradeable, ERC-8004-compatible implementation — adapted from the reference implementation at commit `f2afbb0a7f4a8136c9a66ec55f252b8a68f70776` — and is not an official QDay deployment. See [ARCHITECTURE.md](ARCHITECTURE.md#the-registry).

### Why is the registry non-upgradeable, and why are agent IDs 4–7?

The upstream adaptation deliberately keeps the full wallet API and drops upgradeability so a standalone deploy has no admin upgrade path. Agent IDs are 0-indexed; IDs `0`–`3` are earlier setup/deploy artifacts, and the four seeded demo payees are `4`, `5`, `6` and `7`.

### Are registration files on IPFS?

No — registration files are data URIs. The owner commits name and metadata hashes at allowlist time, and the resolver reads the registry data URI for display and attestation; no IPFS or HTTP document is fetched to authorize a payment. See [VERIFICATION.md](VERIFICATION.md#known-limitations).

### Is the `.well-known` domain check active?

No. The domain tier is advisory and **NOT active in this demo**: it is never consulted by the contract and cannot authorize or block a payment. Only the on-chain Tier 0 checks decide settlement.

### Is the reputation score real?

It is derived from `PaymentSent` events and is explicitly marked stretch. There is no dispute feed, external reputation provider or scoring model, so a payee with no history is not thereby trustworthy.

### Is an LLM actually deciding?

No — the resolver uses a deterministic mock (`LLM_PROVIDER=mock`) with no external model or API key. The LLM has no pay tool and no signing key; the Solidity policy gate makes the decision. See [ARCHITECTURE.md](ARCHITECTURE.md#trust-boundaries).

### Does the agent hold tUSD8?

No. The agent session key `0xF416F16b2dfAB536fE04fF63AFb36cF6274eEC1d` is gas-only and never holds tUSD8; the funds stay in the vault, which transfers directly to `payees[agentId].wallet`. The session has per-payment and cumulative caps, an auto-approve limit, expiry, epoch and revoke.

### Can a prompt injection redirect a payment?

Not at settlement: the `proposeIntent` ABI has no payee argument, the name hash must match what the owner committed, and the wallet is read from the allowlist mapping. In our live scenario 05, the injection produced `PaymentRejected` with reason `NAME_HASH_MISMATCH` and no funds moved; a lookalike that is not allowlisted produces `NOT_ALLOWLISTED`.

### Is the Docker demo a simulation?

No — `docker compose up --build` runs a real local fork of Aevum with the real tUSD8, deploying and seeding four identities and running the eight scenarios. It uses a separate fork chain ID (`440050`) so signatures cannot be replayed on the live testnet, and no private keys are needed.

### Are the receipts final?

No. `pnpm demo` records provisional receipts: they prove inclusion in a block, not finality. `pnpm verify:submission` reported 8/8 PASS on chain `44005`, and the same caveat applies to its output.

### How do I reproduce the results?

Run `make install`, `make build`, `make test` and `make test-fork` offline, or `docker compose up --build` for the full fork demo. For the live chain, set `GUARD_ADDRESS`/`REGISTRY_ADDRESS` (plus the owner/agent keys and four payee addresses) and run `pnpm demo` then `pnpm verify:submission`; full commands are in [VERIFICATION.md](VERIFICATION.md#reproduce-it).

### Is this audited — can I use it with real funds?

No, and not yet. The project is **not audited and testnet only**; the issuer can pause or blacklist tUSD8, and allowlisting is the owner's trust decision. On mainnet you would need a Safe/multisig owner, an audit and a canonical registry; see [SECURITY.md](../SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md#residual-risks).

### What happens if tUSD8 pauses or blacklists a wallet?

The token-level failure reverts the whole transaction and is deliberately **not** a policy reason, so it shows up as a failed transaction rather than a `PaymentRejected` event. Policy failures, by contrast, are recorded by `tryExecuteIntent` with a reason code and no funds moved.

### Can the owner bypass the agent's caps?

Only the per-payment and cumulative caps. Every other check — pause, expiry, approval, allowlist, registry wallet, name/metadata hashes, session epoch, revocation, time window and vault balance — still applies to the owner path. See the [execution rules](../contracts/ABI.md#4-execution-rules-owner-vs-agent).

### Why doesn't the explorer show verified source code?

The Aevum testnet explorer's verifier is not working, so `forge verify-contract` fails for now. Source identity is established by the deploy transactions, the exact deployed commit and this documentation; see [VERIFICATION.md](VERIFICATION.md#known-limitations).

### Can I pay gas in tUSD8 or use account abstraction here?

Not in this demo: there is no supported paymaster, and account abstraction is not required for the challenge. The agent key pays gas in tQDAY while holding no tUSD8; budgets, expiry and revoke are implemented in the vault contract itself.

### Where is the hosted demo and the video?

Hosted demo link will be added in the final README after the Vercel deploy — there is no URL yet, so that line is a deliberate placeholder. The demo video is TBD and its timestamps in [JUDGING-MAP.md](JUDGING-MAP.md) remain marked TBD rather than guessed.

### What is the fastest way for a judge to check the claims?

Open [`docs/tx-table.json`](tx-table.json), click an explorer link, and compare the event/reason with the [scenario results](VERIFICATION.md#scenario-results). Then read the [trust boundary](../README.md#trust-boundary) — one paragraph explains what the contract proves versus what the resolver only attests.
