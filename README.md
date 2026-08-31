<p align="center">
  <img src="docs/brand/splitin-logo.png" alt="SplitIn logo" width="96" height="96">
</p>

<h1 align="center">Open Internal Tools</h1>

<p align="center">
  <a href="https://github.com/splitintech/open-internal-tools/blob/main/LICENSE"><img src="https://img.shields.io/github/license/splitintech/open-internal-tools" alt="MIT license"></a>
  <a href="https://github.com/splitintech/open-internal-tools/stargazers"><img src="https://img.shields.io/github/stars/splitintech/open-internal-tools?style=flat" alt="GitHub stars"></a>
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
  <a href="#use-cases">Use cases</a>
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
- **Break the barriers of software development**: every contributor tasks themselves to make every tool **faster**, **smoother**, and **easier for the user** — **low latency**, **high fidelity**, **least compute**, **least memory**.
- **[mac-unlock-notify](mac-unlock-notify/)**: Slack your phone when this Mac is unlocked.
- **[slack-agent-hq](slack-agent-hq/)**: Slack project-thread router plus taggable Cursor, Claude, Codex, ChatGPT, and specialist bots.
- **[in-app-otp](in-app-otp/)**: `@splitin/in-app-otp` — in-app OTP handoff for marketplace verification.
- **[react-mobile-interactions](react-mobile-interactions/)**: `@splitin/react-mobile-interactions` — swipe, back layers, and native-feeling mobile motion.
- **Careers**: SplitIn tech careers live at [splitin.net/careers-requests](https://www.splitin.net/careers-requests).

## Table of contents

- [Mission](#open-internal-tools-is-how-splitin-lets-open-source-build-the-tech-side-of-small-community-little-capitalist-products)
- [How projects work](#how-projects-work)
- [Who we want](#who-we-want)
- [Getting started](#getting-started)
- [Projects](#projects)
- [Use cases](#use-cases)
- [Contributing](#contributing)
- [Open source](#open-source-vs-splitin-product)
- [We're seeking individual contributors](#were-seeking-individual-contributors)

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
- You task yourself to **break the barriers of software development**: faster, smoother, easy for the user, low latency, high fidelity, least compute, least memory.
- You are comfortable that the package might stay open source **and** later also become a hosted SplitIn product.

If that is you, open an issue to propose a folder, or pick up [mac-unlock-notify](mac-unlock-notify/), [slack-agent-hq](slack-agent-hq/), [in-app-otp](in-app-otp/), or [react-mobile-interactions](react-mobile-interactions/) as maintainer.

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

Packages live in their own folders too:

```zsh
cd open-internal-tools/in-app-otp
npm install && npm test
```

```zsh
cd open-internal-tools/react-mobile-interactions
npm install && npm test
```

Full steps: [in-app-otp/README.md](in-app-otp/README.md) and [react-mobile-interactions/README.md](react-mobile-interactions/README.md).

## Projects

| Product | Tech folder | What it does | Maintainer |
| --- | --- | --- | --- |
| Mac unlock canary | [mac-unlock-notify](mac-unlock-notify/) | Notify Slack on iPhone when this Mac is unlocked | Open — independent contributor / project CTO |
| Slack agent HQ | [slack-agent-hq](slack-agent-hq/) | One Slack thread per project; taggable Cursor/Claude/Codex/ChatGPT plus specialist bots | Open — independent contributor / project CTO |
| In-app OTP | [in-app-otp](in-app-otp/) | Framework-neutral in-app OTP handoff for marketplace verification | Open — independent contributor / project CTO |
| React mobile interactions | [react-mobile-interactions](react-mobile-interactions/) | Swipe tabs, overlay back layers, and native-feeling mobile motion | Open — independent contributor / project CTO |

New products land as a new folder. That folder is the tech for that product.

## Use cases

Ten ways developers integrate this hub into their work. Each product folder also lists **ten** more, specific to that package.

1. **Laptop canary** — install [mac-unlock-notify](mac-unlock-notify/README.md#use-cases) so Slack banners your phone on Mac unlock.
2. **Two-actor verification** — `npm install @splitin/in-app-otp` for tours, trips, pickups, and check-ins ([10 use cases](in-app-otp/README.md#use-cases)).
3. **Native-feeling PWA** — `npm install @splitin/react-mobile-interactions` for swipe tabs, edge-back, and sheets ([10 use cases](react-mobile-interactions/README.md#use-cases)).
4. **Agent HQ in Slack** — run [slack-agent-hq](slack-agent-hq/README.md#use-cases) so Cursor, Claude, Codex, and ChatGPT share one project thread.
5. **Sparse checkout one product** — clone only the folder you need, then follow that README.
6. **New-hire laptop bootstrap** — script `mac-unlock-notify/install.sh --webhook …` next to the rest of the machine setup.
7. **Marketplace live start** — gate a sensitive transition on hashed in-app OTP instead of SMS.
8. **Mobile listing / checkout** — wire swipe and overlay back so Android/iOS back closes the right layer.
9. **CI → same Slack thread** — GitHub failures open one thread, then `NEXT: @Cursor` — not a new channel per bot.
10. **Propose a new product folder** — own it end to end as the specialist; keep it MIT, version it, make it faster and leaner.

## Contributing

We welcome contributions big and small:

- Open an issue or a product request.
- Send a pull request into **one** product folder.
- Work with other contributors **and** agents in the same loop — propose, review, and ship together.
- Task yourself to break the barriers of software development: ship products that are faster, smoother, easy for the user, low latency, high fidelity, and use the least compute and the least memory.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for secrets policy and the specialist model.

Do not commit webhooks, tokens, or local `~/.config` files.

## Open-source vs SplitIn product

Projects start **internal**, then go out as **open-source packages**. They keep improving **version by version**, including out-of-the-box apps and supporting tools for other projects. A package may **stay open source** and later also run as a **hosted proprietary SplitIn product**. SplitIn the company is at [https://www.splitin.net](https://www.splitin.net). Listing here does not mean Slack Marketplace distribution.

## We're seeking individual contributors

Hey! If you're reading this, you've proven yourself as a dedicated README reader.

We are seeking **individual contributors** who want to own a product's tech end to end — and who task themselves to break the barriers of software development so every tool is faster, smoother, easy for the user, low latency, high fidelity, and uses the least compute and the least memory.

Explore SplitIn tech careers at **[https://www.splitin.net/careers-requests](https://www.splitin.net/careers-requests)**.

<p align="center">
  <img src="docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>
