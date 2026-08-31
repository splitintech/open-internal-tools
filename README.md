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
  <a href="https://www.splitin.net">Careers</a>
</p>

<p align="center">
  <img src="docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>

# Open internal tools is how SplitIn lets open source build the **tech side** of small-community little-capitalist products

We let open source build the tech side of the small community little capitalists projects. Maintainers would be confident independent contributors who would love to build the tech for the projects end to end.

We bring open source contributors here to **build and lead end-to-end developer tools**. Those tools can later become proprietary SplitIn products, or stay open source. Think of FFmpeg if it were a little capitalist: a serious end-to-end tool, owned by people who ship it, that makes **end consumers' lives easier** — not a weekend gist.

This repository is MIT open source. Every new folder is the tech part of a product — not a random gist. SplitIn the company lives at [splitin.net](https://www.splitin.net).

- **Product-tech folders**: every new project in this repo is the tech part of a product.
- **Dev tools for consumers**: we build developer tools whose job is to make the end user's life easier.
- **Open now, product later**: a project can remain MIT, or become a proprietary SplitIn product when it earns that path.
- **Maintainer CTOs**: independent contributors own that product's tech end to end.
- **[mac-unlock-notify](mac-unlock-notify/)**: first product-tech — Slack your phone when this Mac is unlocked.
- **Careers**: SplitIn tech careers live at [splitin.net](https://www.splitin.net).

## Table of contents

- [Mission](#open-internal-tools-is-how-splitin-lets-open-source-build-the-tech-side-of-small-community-little-capitalist-products)
- [Who we want](#who-we-want)
- [Getting started](#getting-started)
- [Projects](#projects)
- [Contributing](#contributing)
- [Open source](#open-source-vs-splitin-product)
- [Careers](#careers)

## Who we want

We are not looking for drive-by typo PRs as the main contribution. We want **contributors who build and lead end-to-end projects**:

- You can take a product-tech folder from idea to something people actually use.
- You own scope, architecture, docs, and release for that tool — the project CTO.
- You like FFmpeg-shaped work: one sharp tool, done properly, that consumers feel.
- You are comfortable that the tool might stay open source **or** later become a SplitIn product.

If that is you, open an issue to propose a folder, or pick up [mac-unlock-notify](mac-unlock-notify/) as maintainer.

## Getting started

Clone the program repo, then enter one product folder and follow **that** README.

```zsh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/mac-unlock-notify
chmod +x install.sh uninstall.sh bin/mac-unlock-notify
./install.sh
```

`mac-unlock-notify` installs a macOS LaunchAgent. You will paste a Slack incoming webhook (never commit it). Full steps: [mac-unlock-notify/README.md](mac-unlock-notify/README.md).

## Projects

| Product | Tech folder | What it does | Maintainer |
| --- | --- | --- | --- |
| Mac unlock canary | [mac-unlock-notify](mac-unlock-notify/) | Notify Slack on iPhone when this Mac is unlocked | Open — independent contributor / project CTO |

New products land as a new folder. That folder is the tech for that product.

## Contributing

We welcome contributions big and small:

- Open an issue or a product request.
- Send a pull request into **one** product folder.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for secrets policy and the maintainer model.

Do not commit webhooks, tokens, or local `~/.config` files.

## Open-source vs SplitIn product

This repo is **MIT** community tech. Contributors build end-to-end dev tools here in the open. A tool may **stay open source**, or later be turned into a **proprietary SplitIn product**. SplitIn the company is at [https://www.splitin.net](https://www.splitin.net). Listing here does not mean Slack Marketplace distribution.

## Careers

Independent contributors who want to own a product's tech end to end — and people exploring SplitIn tech careers — start at **[https://www.splitin.net](https://www.splitin.net)**.

<p align="center">
  <img src="docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>
