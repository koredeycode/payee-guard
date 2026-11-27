# Security policy

## Status

**Payee Guard is not audited and is testnet only (Aevum chain `44005`).** Do not deposit real value. The issuer can pause or blacklist tUSD8; allowlisting is the owner's trust decision; and a mainnet deployment must use a Safe/multisig owner plus an independent audit. See [THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository: https://github.com/koredeycode/payee-guard/security/advisories/new.

Do **not** open a public issue for a security bug, and do not post exploit details in chat, discussions or a demo recording. Include:

- affected contract/address and commit (the deployed code is at commit `4fab0da04237ae1b543745e471132ad83c92d1be`);
- a minimal reproduction (transaction hashes or a Foundry test are ideal);
- impact and a suggested fix, if you have one.

We will acknowledge a private report and keep you informed while we triage it. Please give us a reasonable chance to fix and coordinate disclosure before publishing. Good-faith research against the testnet deployment is welcome; do not use public anvil keys against live chain `44005`, and do not attempt to access any private key or hosted infrastructure.

## In scope

- [`PayeeGuard.sol`](contracts/src/PayeeGuard.sol) at `0xb0E96A17dC3677AAb535dfDB0cD37433477931ef`: payee derivation, allowlist, sessions (caps, expiry, epoch, revoke), intents (approve/execute/cancel), policy reason codes, `tryExecuteIntent` non-reverting rejections, vault accounting and pause.
- [`IdentityRegistry.sol`](contracts/src/IdentityRegistry.sol) at `0x0C286c822f26ecEa30aC7872AC45895a2C2614b2`: ERC-8004-compatible registration, EIP-712 `setAgentWallet`, metadata and ownership rules.
- The verification and demo scripts that produce [`docs/tx-table.json`](docs/tx-table.json) receipts and the off-chain resolver in [`agent/`](agent/README.md).

## Out of scope

- Findings that require the owner key to be malicious: the owner is trusted by design (allowlisting is the owner's trust decision).
- tUSD8 issuer behaviour: the token can pause or blacklist, and token-level failures revert rather than producing policy reasons.
- Lack of a canonical ERC-8004 registry on Aevum 44005, advisory domain `.well-known` checks, or the deterministic mock LLM (`LLM_PROVIDER=mock`) — these are documented limitations, not vulnerabilities. See [FAQ](docs/FAQ.md).
- Test-only keys and demo accounts, the hosted demo at https://payee-guard.vercel.app (built from current `main`; `/demo` verdicts are fixtures), and third-party dependencies — report those to their own maintainers.

## Safe handling

- Never commit a private key, `.env` file or API key; the scripts read owner/agent keys from the environment only.
- Use a fresh test wallet for `OWNER_PRIVATE_KEY`/`AGENT_PRIVATE_KEY`; the tools refuse public anvil keys on live chain `44005`.
- Treat every receipt in [`docs/tx-table.json`](docs/tx-table.json) as provisional: inclusion, not finality.

## Credits and licenses

See [NOTICE.md](NOTICE.md). This project is MIT licensed; see [LICENSE](LICENSE).
