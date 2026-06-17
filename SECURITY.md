# Security Policy

`open-identities` stores identity records that may include sensitive identifiers, contact points, and private agent documents.

## Reporting

Report security issues privately to `andrei@hasna.com`. Do not open public issues for vulnerabilities involving identity disclosure, token leakage, filesystem permissions, or sync boundary bypasses.

## Handling Sensitive Data

- Do not commit real identity records, government identifiers, private phone numbers, private email addresses, provider tokens, or generated local stores.
- Mark regulated or government identifiers with `sensitive: true`.
- Default exports and sync adapters must use a non-sensitive public identifier.
- Private documents such as `SOUL.md`, `MEMORY.md`, and `CONSENT.md` should only be propagated to another system when that feature explicitly requires it.

