# Third-party notices

**Payee Guard is based on Aevum Starter Kit (MIT, Copyright 2026 PQA Labs)** —
https://github.com/qday-io/aevum-starter-kit. See [LICENSE](LICENSE). The starter kit is MIT licensed
and builds on the open-source projects below. None of their code is copied into this repository: the
Solidity libraries are git submodules that keep their own LICENSE files, and the JavaScript packages
are installed from npm.

## Identity registry adaptation

`contracts/src/IdentityRegistry.sol` is a self-deployed, non-upgradeable, ERC-8004-compatible
adaptation of the reference implementation at
https://github.com/erc-8004/erc-8004-contracts, commit
`f2afbb0a7f4a8136c9a66ec55f252b8a68f70776` (full wallet API; upgradeability removed for a standalone
deploy). The upstream copyright and license headers remain in the adapted source; consult the upstream
repository for its license. **No canonical ERC-8004 registry exists on Aevum 44005** — this is our own
deployment, not an official QDay registry. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-registry).

## Design credit

UI guidance follows *unslop* by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), licensed
**CC BY 4.0**: https://heydamir.design/unslop. Credit retained under the terms of that license.

## Solidity libraries (`contracts/lib`, git submodules)

| Project | Version | License | Source |
|---|---|---|---|
| forge-std | v1.9.6 | MIT or Apache-2.0 | https://github.com/foundry-rs/forge-std |
| OpenZeppelin Contracts | v5.1.0 | MIT | https://github.com/OpenZeppelin/openzeppelin-contracts |

## JavaScript packages (direct dependencies)

| Package | Version | License | Used in |
|---|---|---|---|
| next | 16.4.3 | MIT | web |
| react, react-dom | 19.2.0 | MIT | web |
| @rainbow-me/rainbowkit | 2.2.11 | MIT | web |
| wagmi | 2.19.5 | MIT | web |
| @tanstack/react-query | 5.90.2 | MIT | web |
| viem | 2.57.12 | MIT | web, examples, packages/aevum |
| tsx | 4.23.15 | MIT | examples (dev) |
| typescript | 5.9.3 | Apache-2.0 | all (dev) |

Their own dependencies carry their own licenses. To list them all, run `pnpm licenses list` in the repo root.
