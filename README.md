<p align="center">
  <img src="docs/brand/splitin-logo.png" alt="SplitIn logo" width="96" height="96">
</p>

<h1 align="center">Open Internal Tools</h1>

<p align="center">
  <a href="https://github.com/splitintech/open-internal-tools/blob/main/LICENSE"><img src="https://img.shields.io/github/license/splitintech/open-internal-tools" alt="MIT license"></a>
  <a href="https://github.com/splitintech/open-internal-tools/graphs/contributors"><img src="https://img.shields.io/github/contributors/splitintech/open-internal-tools" alt="Contributors"></a>
  <a href="https://github.com/splitintech/open-internal-tools/issues"><img src="https://img.shields.io/github/issues/splitintech/open-internal-tools" alt="Issues"></a>
</p>

<p align="center">
  <a href="#getting-started">Docs</a>
  ·
  <a href="#contributing">Community</a>
  ·
  <a href="#projects">Projects</a>
  ·
  <a href="https://www.splitin.net/careers-requests">Careers</a>
</p>

<p align="center">
  <img src="docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>

# Open internal tools is how SplitIn lets open source build the **tech side** of small-community little-capitalist products

We let open source build the tech side of the small community little capitalists projects. Maintainers would be confident independent contributors who would love to build the tech for the projects end to end.

We bring open source contributors here to **build and lead end-to-end developer tools**. Projects are **built internally first**, then **open sourced as packages** others can use. A package can **stay open source** and later also ship as a **hosted proprietary SplitIn product**. Think of FFmpeg if it were a little capitalist: a serious end-to-end tool, owned by people who ship it, that makes **end consumers' lives easier** — not a weekend gist.

This repository is MIT open source. Every new folder is the tech part of a product — not a random gist. SplitIn the company lives at [splitin.net](https://www.splitin.net).

- **Internal, then packages**: we build in-house, then publish packages so others can use the same tool.
- **Stay open, host later**: a project can remain MIT and, when it earns it, also become a hosted SplitIn product.
- **Version by version**: every project keeps improving release by release, with out-of-the-box applications.
- **Tools that support tools**: we build as many internal supporting tools as other projects need.
- **Domain and tool specialists**: each specialist maintains everything for that tool or domain end to end.
- **People and agents, in sync**: every contributor works with other contributors **and** agents synchronously.
- **[mac-unlock-notify](mac-unlock-notify/)**: first product-tech — Slack your phone when this Mac is unlocked.
- **[slack-agent-hq](slack-agent-hq/)**: Slack project-thread router plus taggable Cursor, Claude, Codex, ChatGPT, and specialist bots.
- **Careers**: SplitIn tech careers live at [splitin.net/careers-requests](https://www.splitin.net/careers-requests).

## Table of contents

- [Mission](#open-internal-tools-is-how-splitin-lets-open-source-build-the-tech-side-of-small-community-little-capitalist-products)
- [How projects work](#how-projects-work)
- [Who we want](#who-we-want)
- [Getting started](#getting-started)
- [Projects](#projects)
- [Contributing](#contributing)
- [Open source](#open-source-vs-splitin-product)
- [Careers](#careers)

## How projects work

1. **Build internally.** A domain or tool specialist owns the work end to end inside SplitIn.
2. **Open source as a package.** Others can install and use it. It can stay MIT forever.
3. **Keep shipping versions.** Out-of-the-box applications improve release by release.
4. **Support other projects.** Spin up as many internal tools as sibling products need.
5. **Hosted product when it earns it.** The same line of work can later run as a proprietary SplitIn hosted service.
6. **Work in sync.** Contributors coordinate with other contributors and with agents in the same thread of work — not in isolated handoffs.

## Who we want

We are not looking for drive-by typo PRs as the main contribution. We want **contributors who build and lead end-to-end projects**:

- You are a **domain specialist** or **tool specialist** and you maintain everything for that domain or tool.
- You can take a product-tech folder from internal build → package → versioned out-of-the-box app.
- You own scope, architecture, docs, and release — the project CTO.
- You like FFmpeg-shaped work: one sharp tool, done properly, that consumers feel.
- You work **synchronously with other contributors and agents**, not as a solo silo.
- You are comfortable that the package might stay open source **and** later also become a hosted SplitIn product.

If that is you, open an issue to propose a folder, or pick up [mac-unlock-notify](mac-unlock-notify/) or [slack-agent-hq](slack-agent-hq/) as maintainer.

## Getting started

Clone the program repo, then enter one product folder and follow **that** README.

```zsh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/mac-unlock-notify
chmod +x install.sh uninstall.sh bin/mac-unlock-notify
./install.sh
```

`mac-unlock-notify` installs a macOS LaunchAgent. You will paste a Slack incoming webhook (never commit it). Full steps: [mac-unlock-notify/README.md](mac-unlock-notify/README.md).

Slack agent HQ is a separate product. Install it from its own folder:

```zsh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/slack-agent-hq
chmod +x install.sh
./install.sh
```

Full steps: [slack-agent-hq/README.md](slack-agent-hq/README.md).

## Projects

| Product | Tech folder | What it does | Maintainer |
| --- | --- | --- | --- |
| Mac unlock canary | [mac-unlock-notify](mac-unlock-notify/) | Notify Slack on iPhone when this Mac is unlocked | Open — independent contributor / project CTO |
| Slack agent HQ | [slack-agent-hq](slack-agent-hq/) | One Slack thread per project; taggable Cursor/Claude/Codex/ChatGPT plus specialist bots | Open — independent contributor / project CTO |

New products land as a new folder. That folder is the tech for that product.

## Contributing

We welcome contributions big and small:

- Open an issue or a product request.
- Send a pull request into **one** product folder.
- Work with other contributors **and** agents in the same loop — propose, review, and ship together.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for secrets policy and the specialist model.

Do not commit webhooks, tokens, or local `~/.config` files.

## Open-source vs SplitIn product

Projects start **internal**, then go out as **open-source packages**. They keep improving **version by version**, including out-of-the-box apps and supporting tools for other projects. A package may **stay open source** and later also run as a **hosted proprietary SplitIn product**. SplitIn the company is at [https://www.splitin.net](https://www.splitin.net). Listing here does not mean Slack Marketplace distribution.

## Careers

Independent contributors who want to own a product's tech end to end — and people exploring SplitIn tech careers — start at **[https://www.splitin.net/careers-requests](https://www.splitin.net/careers-requests)**.

<p align="center">
  <img src="docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>
