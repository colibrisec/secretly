# Contributing to Secretly

Thanks for helping make Secretly a more useful open-source Slack security bot. Contributions to code, detection patterns, documentation, tests, and bug reports are welcome.

## Before you start

- Search existing [issues](https://github.com/colibrisec/secretly/issues) before opening a new one.
- For substantial changes, open an issue first so the approach can be discussed before implementation.
- Do not report security vulnerabilities in public issues. Follow the [security policy](SECURITY.md) instead.

## Development setup

Requires Node.js 22.

```console
git clone https://github.com/colibrisec/secretly.git
cd secretly
npm ci
npm run test:ci
npm run build
```

Running the bot locally also needs PostgreSQL and Redis. See the [README](../README.md) and [deployment guide](../docs/DEPLOYMENT.md).

## Making a change

1. Create a focused branch from `main`.
2. Keep changes small and limited to one purpose.
3. Add or update tests for changed behavior.
4. Update documentation when user-visible behavior, configuration, or deployment changes.
5. Run the checks below before opening a pull request.

```console
npm run lint
npm run typecheck
npm run test:ci
npm run build
```

## Pull requests

- Explain what changed and why it matters.
- Link the related issue when one exists.
- Include tests that demonstrate the intended behavior and regressions being prevented.
- Keep generated files, unrelated formatting changes, and secrets out of the pull request.
- Ensure all CI checks pass before requesting review.

## Detection patterns

Detection patterns live in `src/detectors/patterns.ts`. Detection should prioritize clear, actionable findings. Include positive and negative test cases, prefer a validator (like the Luhn check for card numbers) over a broader expression to avoid false positives, and assemble secret-shaped test fixtures from parts so the security scan does not report them as real secrets.

## Code of conduct

Be respectful, constructive, and professional. Harassment and abusive behavior are not welcome.
