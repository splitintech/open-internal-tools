# Contributing to open internal tools

Every folder in this repository is the **tech part of a product**. Open a pull request against **one** product folder at a time.

## Who we want

**Domain specialists** and **tool specialists** who maintain that domain or tool end to end. You pick the **right language and OSS for the job**, keep **indie-developer cost**, **can write without AI**, and **delegate to LLMs and multi-agent workflows** to solve more problems and ship faster. Build internally → open-source package → versioned out-of-the-box apps. Work **synchronously with other contributors and agents**. A package may stay MIT and later also become a hosted SplitIn product.

See the hub [README tech stack](README.md#tech-stack) before you add a dependency.

## How to work

1. Fork or branch from `main`.
2. `cd` into the product-tech folder (for example `mac-unlock-notify`, `slack-agent-hq`, `ideation-loop-system`, `in-app-otp`, `react-mobile-interactions`, or `vscode-agent-router`).
3. Follow that folder's README. Keep PRs inside that one folder. Match the language already used there unless the job needs a different one.
4. Coordinate in the same loop as other contributors and agents — do not silo the work.
5. Keep secrets out of git. Never commit Slack webhooks, tokens, or `~/.config` files.

## Maintainers

Each **domain specialist** or **tool specialist** owns everything for that tool or domain: scope, architecture, docs, versions, out-of-the-box apps, and supporting internals. They are the SplitIn tech-career CTO for that project. They ship in sync with other specialists and agents.

## Careers

SplitIn tech careers: [https://www.splitin.net/careers-requests](https://www.splitin.net/careers-requests)
