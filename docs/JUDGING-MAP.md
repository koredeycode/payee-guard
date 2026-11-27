# Payee Guard — judging map

Official criteria and weights come from the [challenge page](https://qday.io/builder-challenge) and the [DoraHacks event](https://dorahacks.io/hackathon/qday); they win over anything here. **The demo video is not recorded: every video timestamp below is TBD.** Replace `TBD` with real timestamps once the recording exists; do not invent them. The hosted demo is **live and public** at https://payee-guard.vercel.app (`/`, `/demo`, `/console`, `/receipts`), built from current `main` with Next.js `16.4.6`; the contracts remain deployed at commit `4fab0da…`. The read-only `/demo` data is fixture data with placeholder hashes — real receipts are in [`tx-table.json`](tx-table.json).

Track: **Confirmation of Payee** (primary), **Native AI Assistants** (secondary). Submission write-up: [SUBMISSION.md](SUBMISSION.md).

| # | Official criterion | Weight | Evidence in this repo | Video timestamp |
|---|---|---|---|---|
| 1 | **User Experience & Presentation** — intuitive UI, onboarding, clear status/error feedback; clear pitch | 15 | [README pitch + hero placeholder](../README.md#payee-guard), [read-only judge UI](../web/src/app/demo/page.tsx) (fixture data, not chain evidence), [red rejection block + diff component](../web/src/components/guard/SpoofDiff.tsx), [demo-day screen script](DEMO-DAY.md#four-minute-script), [FAQ](FAQ.md) | **TBD** |
| 2 | **Demo — clear and well-structured**, reliable testnet demo with live activity and failures | 10 | [Live hosted demo](https://payee-guard.vercel.app) (built from current `main`; `/demo` verdicts are fixtures), [demo-day runbook](DEMO-DAY.md), [8 executed receipts](tx-table.json) incl. [`PaymentSent` 01](https://explorer-test.qday.info/tx/0x520e5032a30ab9a4a16337f12c41e1af70693018ca56c00428b12ca31fda87c6) and [`NOT_ALLOWLISTED` 02](https://explorer-test.qday.info/tx/0xcfbe99bd53c8fb1a6b89195567f83f93d0a10b59d2585d4bd1fc8517fc77b65c), [repro commands](VERIFICATION.md#reproduce-it), `docker compose up --build` (real local fork) | **TBD** |
| 3 | **Documentation** — problem, architecture, workflows, technologies, assumptions, limits, roadmap | 10 | [README](../README.md), [Architecture](ARCHITECTURE.md), [Verification](VERIFICATION.md), [Threat model](THREAT-MODEL.md), [FAQ](FAQ.md), [Business](BUSINESS.md), [Prior art](prior-art.md), [authoritative ABI](../contracts/ABI.md) | **TBD** |
| 4 | **Innovation and originality** — beyond templates; agentic payments | 20 | [On-chain policy gate: payee derived from `payees[agentId].wallet`](../contracts/src/PayeeGuard.sol), [prompt-injection → `NAME_HASH_MISMATCH` receipt 05](https://explorer-test.qday.info/tx/0xeb912e3876936af9fe8c9ef701fe2cc6d3dd402fa784f2d24f4e7c3682291281), [honest differentiation](prior-art.md), [business model](BUSINESS.md) | **TBD** |
| 5 | **Technical quality and platform integration** — correct Aevum use, tested code | 15 | [Deployed addresses + commit + compiler settings](VERIFICATION.md#deployment), [ABI](../contracts/ABI.md), 60 unit/fuzz/invariant + 6 fork tests green, Shanghai opcode check green, [CI from starter kit](../.github/workflows) | **TBD** |
| 6 | **Real-world utility** — real problem, clear audience, path to merchants/agents/mainnet | 15 | [Business model](../README.md#business-model) and [BUSINESS.md](BUSINESS.md), [roadmap](../README.md#roadmap), [threat model residual risks](THREAT-MODEL.md#residual-risks) | **TBD** |
| 7 | **Safety, trust and controls** — least privilege, caps, safe keys, injection protection, receipts, revoke | 15 | [Trust boundary](../README.md#trust-boundary), [state machine + revoke sequences](ARCHITECTURE.md#contract-state-machine), [16 reason codes](../contracts/ABI.md#5-policy-reason-codes-all-16-exact-bytes32-values), live refusals: [`SESSION_REVOKED` 04](https://explorer-test.qday.info/tx/0xb65e3f6f1c87f8de6d47a0001ba82eee9ef6db2811d280e535a37e0a516fa0b4), [`INTENT_EXECUTED` 07](https://explorer-test.qday.info/tx/0x27ea562597a20dc4de526444f5664ea513a26a11f38c599e10154b58fc95bb59), [`PAYEE_CHANGED` 08](https://explorer-test.qday.info/tx/0xf0562ca8e9d2fd3d67031d4a26e227fa428ae1952c128e92d7163bb5d629fbb5), [8/8 verified outcomes](tx-table.json), [SECURITY.md](../SECURITY.md) | **TBD** |

---

## 30-second judge path

1. Open [`docs/tx-table.json`](tx-table.json) and click any explorer link — eight live Aevum receipts: `PaymentSent` (01, 06) and policy rejections (02–05, 07, 08).
2. Read the [one-line pitch and trust boundary](../README.md#trust-boundary): the contract proves Tier 0; the resolver attests Tiers 1–3.
3. Run `docker compose up --build` for the same flow on a real local fork, or `make build && make test` for the offline checks.

## Before the recording

- [ ] Record the 3–5 minute walkthrough: problem → trusted payment → lookalike rejection → prompt injection → approval → revoke.
- [ ] Replace every **TBD** in the table with the video's own timestamps.
- [x] Hosted demo is live at https://payee-guard.vercel.app and linked in the README's Links section (built from current `main`; no contract redeploy).
- [ ] Re-run `pnpm verify:submission` on the day and confirm 8/8 PASS with provisional receipts.
