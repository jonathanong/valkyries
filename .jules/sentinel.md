## 2025-05-18 - [Weak Random Number Generation]

**Vulnerability:** Weak random number generation using `Math.random()` in security-sensitive contexts (rate limiter).
**Learning:** Predictable PRNGs (`Math.random()`) can lead to token collisions or predictability attacks. The codebase was using it to generate unique random elements for rate limiting sets.
**Prevention:** Always use Cryptographically Secure Pseudo-Random Number Generators (CSPRNG), such as `randomUUID()` from `node:crypto`, when dealing with tokens or values in security-related contexts like rate limiting.
