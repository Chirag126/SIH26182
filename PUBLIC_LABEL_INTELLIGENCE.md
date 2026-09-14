# Public Label Intelligence Layer

This project now uses the public `ImMike/crypto-wallet-address-labels` repository as an **additive intelligence source**.

## What happens at runtime

1. The existing blockchain trace runs exactly as before.
2. The backend starts a background sync of the public repository.
3. Dataset files under `datasets/` are downloaded and normalized automatically.
4. EVM addresses are indexed locally in memory/cache for fast lookup.
5. During a real-wallet investigation, only the addresses already discovered by the existing trace are checked against the index.
6. Exchange/custodian labels are converted into the existing VASP evidence contract.
7. Scam, sanctioned, mixer and bridge labels can add additional trail-risk evidence.
8. Existing Etherscan, behavioral, deposit, hot-wallet, clustering and PublicAML evidence remains active.

## Important behavior

- The `0xABC` and `0xMIXABC` demo path is untouched.
- The existing real-wallet tracing engine is not replaced.
- If GitHub is unavailable, the investigation continues with the existing intelligence sources and any cached label index.
- The public label repository is refreshed automatically every 6 hours when the running instance is active.
- Labels are treated as supporting evidence, not proof of ownership. The upstream repository itself warns that labels can be incomplete or outdated.

## Endpoint

`GET /intelligence/status` reports the label-sync state, number of indexed EVM addresses, scanned dataset files and the latest error (if any).
