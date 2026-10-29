# Product repository protection

Verified on 2026-10-29 for all 14 independently maintained products. Each repository's
active branch ruleset targets `~DEFAULT_BRANCH`, currently `main`, and has no bypass actors.

- Force pushes and deletion of the default branch are blocked.
- Changes must arrive through a pull request.
- The existing CI checks listed below must pass, with the branch up to date against its base.
- Required checks are bound to the GitHub Actions integration (app ID 15368).
- No approving reviewer is required, so a sole maintainer can merge a passing PR.
- Publishing, scheduled-only jobs and Dependabot updates are not required merge checks.

These rules protect the default branch. They do not block deletion of ordinary feature
branches or restrict repository deletion through administrator settings. Repository
administrators retain the ability to edit rulesets. No bypass actor was added.

## Repository rules and required checks

Each repository link below opens its ruleset in GitHub.

| Repository ruleset | Required CI checks |
| --- | --- |
| [airdrop-qr](https://github.com/splitintech/airdrop-qr/rules/26135340) | `check (22)`, `check (24)` |
| [in-app-otp](https://github.com/splitintech/in-app-otp/rules/26135349) | `check (22)`, `check (24)` |
| [rtf-to-vcard](https://github.com/splitintech/rtf-to-vcard/rules/26135351) | `python (3.12)`, `python (3.9)` |
| [mac-unlock-notify](https://github.com/splitintech/mac-unlock-notify/rules/26135356) | `check` |
| [verification-adapter-sdk](https://github.com/splitintech/verification-adapter-sdk/rules/26135360) | `Analyze JavaScript/TypeScript`, `check (20)`, `check (22)`, `coverage`, `hono-worker`, `import-smoke`, `postgres (15)`, `postgres (16)` |
| [dev-tools-client](https://github.com/splitintech/dev-tools-client/rules/26135363) | `check (22)`, `check (24)` |
| [slack-agent-hq](https://github.com/splitintech/slack-agent-hq/rules/26135366) | `check (22)`, `check (24)` |
| [ideation-loop-system](https://github.com/splitintech/ideation-loop-system/rules/26135370) | `check (22)`, `check (24)` |
| [vscode-agent-router](https://github.com/splitintech/vscode-agent-router/rules/26135374) | `check (22)`, `check (24)` |
| [group-share](https://github.com/splitintech/group-share/rules/26135377) | `verify (22)`, `verify (24)` |
| [jpmc-zelle-quick-pay](https://github.com/splitintech/jpmc-zelle-quick-pay/rules/26135006) | `verify` |
| [neighborhood-map-studio](https://github.com/splitintech/neighborhood-map-studio/rules/26135389) | `verify` |
| [outreach-engine](https://github.com/splitintech/outreach-engine/rules/26135392) | `check (22)`, `check (24)` |
| [moggridge](https://github.com/splitintech/moggridge/rules/26135398) | `package (22)`, `package (24)` |

Zelle's existing `Protect` ruleset was updated in place: it previously had an empty branch
selector and therefore did not apply to `main`. The other rulesets were newly created.

## Verification and maintenance

The [JSON record](repository-protection.json) contains the ruleset IDs, read-back
configuration, verification timestamps and unchanged main commit IDs. Verification used
GitHub's effective branch-rules endpoint and confirmed `main` is protected in every
repository. No force push, deletion or failing merge was attempted as a test.

This file is a dated configuration snapshot, not live enforcement. The catalog CI checks
its structure and coverage; GitHub enforces the live rules. When renaming CI jobs, update
the corresponding required check names to avoid blocking merges. Keep an unconditional
pull-request trigger for each required job. Adding or changing a product requires updating
the catalog and reviewing its branch protection.

See [GitHub's ruleset API documentation](https://docs.github.com/en/rest/repos/rules) for
rule behavior and the effective branch-rules endpoint.
