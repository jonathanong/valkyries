## 2025-05-18 - [Weak Random Number Generation]

**Vulnerability:** Weak random number generation using `Math.random()` in security-sensitive contexts (rate limiter).
**Learning:** Predictable PRNGs (`Math.random()`) can lead to token collisions or predictability attacks. The codebase was using it to generate unique random elements for rate limiting sets.
**Prevention:** Always use Cryptographically Secure Pseudo-Random Number Generators (CSPRNG), such as `randomUUID()` from `node:crypto`, when dealing with tokens or values in security-related contexts like rate limiting.
## 2026-05-22 - Uncaught Execution via False Argument in Valkey Client
**Vulnerability:** Uncaught Execution via False Argument. The `raiseOnError` flag in `@valkey/valkey-glide` `client.exec(batch, false)` was set to `false`, causing batch command failures to silently return as values instead of throwing exceptions.
**Learning:** Bypassing exception mechanisms by disabling error flags can quietly mask critical failures, causing dependent `catch` blocks or failure-handling logic to be skipped.
**Prevention:** Always verify that SDK configurations that toggle error behavior (like `raiseOnError`) are set to true when relying on standard `try/catch` flows.
