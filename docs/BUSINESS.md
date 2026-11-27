# Payee Guard — business model

## The paragraph

Treasury teams, marketplaces and agent operators that let software propose stablecoin payments need a cheap way to answer "is this really the payee I approved?" before money moves. Payee Guard is a confirmation-of-payee layer they pay for as a hosted verification API or SDK: the customer funds its own vault and owns the allowlist and session policy, while we charge per verified payment or a subscription for the resolver, the audit trail and a dashboard of `PaymentSent` / `PaymentRejected` receipts. The contract is the trust anchor the customer can inspect without trusting our servers, so we earn fees on decisions rather than float on customer balances. A mainnet path requires a Safe/multisig owner, an independent audit and a canonical ERC-8004 registry — none of which exist in this testnet demo.

## Who pays and why

| Buyer | Problem | What they buy |
|---|---|---|
| Corporate treasury / finance ops | Vendor-impersonation and address-poisoning risk in stablecoin payments | Allowlisting workflow, per-session budgets and expiry, human approval above a limit, exportable decision trail |
| Marketplaces and platforms | Payouts to sellers initiated by automated systems | A gate that binds each payout to an allowlisted identity and a committed name hash |
| Agent operators | An AI agent must pay for APIs, compute or data without an unlimited wallet | Gas-only session keys with caps, revocation and single-use intents; no agent-held funds |

The audience is real: the [Confirmation of Payee track](https://qday.io/builder-challenge) exists because name-to-address mismatches cause irreversible losses. Our demo does not claim customers, revenue or pricing; it demonstrates the mechanism a paying product would sit on top of.

## Why the on-chain part matters commercially

- **Verifiable receipts.** `PaymentSent` and `PaymentRejected(intentId, caller, reason)` are events anyone can check with the [explorer](https://explorer-test.qday.info) and [`pnpm verify:submission`](VERIFICATION.md#reproduce-it). A customer does not have to trust our database to reconstruct why a payment happened.
- **Least privilege is enforceable, not promised.** Caps, expiry, epoch and revoke are in [`PayeeGuard.sol`](../contracts/src/PayeeGuard.sol), not in a policy config our service could quietly change.
- **The payee is not a request parameter.** `proposeIntent` derives it from `payees[agentId].wallet`, which removes the most valuable injection target.
- **Refusals are auditable.** `tryExecuteIntent` records the exact reason code while moving no funds — useful for compliance review and dispute handling.

## Go-to-market sketch (no numbers claimed)

1. Ship the SDK and hosted resolver against Aevum testnet; publish the [verification record](VERIFICATION.md) and [threat model](THREAT-MODEL.md) so integrators can evaluate the gate.
2. Pilot with one treasury or marketplace flow where a human reviews exceptions above the auto-approve limit; keep the customer in control of the owner key.
3. Move the owner to a Safe/multisig, commission an audit, and migrate to a canonical ERC-8004 registry when one exists on Aevum.
4. Only then discuss mainnet pricing and service levels. Nothing in this repository promises tokens, returns or a mainnet launch.

## What must be true before charging anyone

- **Not audited; testnet only.** No real funds should ever be deposited into this deployment.
- **The issuer can pause or blacklist tUSD8.** Settlement availability depends on the token, not on us.
- **Allowlisting is the owner's trust decision.** The resolver cannot repair a bad allowlist; a product must make the review workflow explicit.
- **Use a Safe/multisig owner on mainnet.** The test owner `0x0a939e…0f97` is a single key with allowlist, session, approval, pause and withdrawal authority.
- **Advisory tiers must be labelled as such.** Domain `.well-known` is not active, and reputation is derived from `PaymentSent` events — marked stretch. The [FAQ](FAQ.md) and [spoof/diff walkthrough](ARCHITECTURE.md#spoof--prompt-injection--scenarios-02-and-05-paymentrejected) keep that distinction visible.

See [prior art](prior-art.md) for what other projects in this challenge cover, and [SUBMISSION.md](SUBMISSION.md) for the concise write-up.
