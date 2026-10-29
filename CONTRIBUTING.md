# Contributing to open internal tools

This repository is the catalog for independently maintained Open Internal Tools products. Product pull requests belong in their canonical repositories.

## Who we want

**Domain specialists** and **tool specialists** who maintain that domain or tool end to end. You pick the **right language and OSS for the job**, keep **indie-developer cost**, **can write without AI**, and **delegate to LLMs and multi-agent workflows** to solve more problems and ship faster. Build internally → open-source package → versioned out-of-the-box apps. Work **synchronously with other contributors and agents**. A package may stay MIT and later also become a hosted SplitIn product.

See the hub [README tech stack](README.md#tech-stack) before you add a dependency.

## How to work

1. Select the canonical repository from the [project catalog](README.md#projects).
2. Follow that repository's README and contributor instructions. Product code, tests, issues and releases belong there.
3. Submit hub pull requests for catalog, program guidance and migration notices.
4. Coordinate with the product maintainer and keep credentials and local configuration out of Git.

## Releases

The hub no longer publishes the migrated products. Public package names and existing release-tag conventions remain unchanged. Configure npm trusted publishing or marketplace credentials for the standalone repository before enabling its release workflow. Follow each product's `docs/repository-release.md` where supplied; Moggridge retains its own publishing guide.

Historical hub tags and releases remain available. Do not publish the same product from both repositories. The [migration ledger](docs/migrations/2026-10-29.json) records pinned source and destination revisions. Branch-only projects are outside this migration and retain their current status.

## Maintainers

Each **domain specialist** or **tool specialist** owns everything for that tool or domain: scope, architecture, docs, versions, out-of-the-box apps, and supporting internals. They are the SplitIn tech-career CTO for that project. They ship in sync with other specialists and agents.

## Careers

SplitIn tech careers: [https://www.splitin.net/careers-requests](https://www.splitin.net/careers-requests)
