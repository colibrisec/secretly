# Security Policy

## Supported versions

Security fixes are made on the latest release. Until v1.0.0 is published, fixes are made on `main`. Older releases do not receive fixes, so upgrade to the latest release.

## Reporting a vulnerability

Do not open public issues, discussions or pull requests for vulnerabilities.

Report them privately through GitHub: open the repository's Security tab and choose "Report a vulnerability", or go to https://github.com/colibrisec/secretly/security/advisories/new.

Please include:

- a description of the vulnerability and its impact
- the affected version or commit, and how it is deployed (Docker, Helm)
- steps to reproduce or a proof of concept
- a suggested fix, if you have one
- whether it could expose Slack message content or stored obfuscation records

## What to expect

Reports are handled on a best-effort basis, as quickly as possible, with no fixed timelines. You will be kept informed as the report progresses. You will be credited in the advisory unless you prefer to stay anonymous.

## Scope

In scope:

- the bot's source code
- the published container image
- the Helm chart
- the workflows in this repository

Out of scope:

- vulnerabilities in third-party dependencies; report them upstream, and tell us if Secretly makes one exploitable
- problems that require a compromised Slack workspace admin account or access to the host
- misconfigured deployments, such as a weak encryption key

## Disclosure

Disclosure is coordinated. A GitHub security advisory is published once a fix is available. Please allow reasonable time before disclosing publicly.
