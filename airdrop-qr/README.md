# @splitin/airdrop-qr

Turn any URL catalog into **offline self-contained HTML cards** with embedded SVG QR codes. Open a file on a phone, AirDrop it, and someone else scans into the live URL.

No CDN. No network needed to *display* the card — only the scanned destination hits the internet.

```sh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/airdrop-qr
npm install
npm test
npm run build
```

## Install

```bash
npm install @splitin/airdrop-qr
```

## CLI

From a JSON catalog:

```bash
npx airdrop-qr --out ./cards --catalog ./examples/sample-catalog.json
```

Or flags:

```bash
npx airdrop-qr --out ./cards --brand "Acme" \
  --url https://example.com/hosts --label "Hosts" --slug hosts \
  --url https://example.com/renters --label "Renters" --slug renters \
  --utm-source airdrop --utm-medium qr
```

## Library

```ts
import { generateKit } from "@splitin/airdrop-qr";

await generateKit({
  brand: "Acme",
  outDir: "./cards",
  utm: { source: "airdrop", medium: "qr" },
  entries: [
    {
      slug: "hosts",
      label: "Hosts",
      url: "https://example.com/hosts",
      blurb: "Scan to join",
    },
  ],
});
```

## Catalog schema

See [`examples/sample-catalog.json`](examples/sample-catalog.json).

| Field | Required | Notes |
| --- | --- | --- |
| `brand` | yes | Wordmark on every card |
| `entries[]` | yes | Non-empty |
| `entries[].slug` | yes | kebab-case filename |
| `entries[].label` | yes | Card title |
| `entries[].url` | yes | Absolute `https://` URL |
| `entries[].blurb` | no | Defaults to “Scan to open the link” |
| `utm.source` / `utm.medium` | no | When set, QR encodes UTM; visible link stays clean |
| `accent` / `background` / `ink` | no | Theme colors |

Each QR destination is the entry URL plus optional UTM (`utm_campaign` defaults to the slug). The tappable link under the QR is the clean URL.

## AirDrop

1. Generate cards into a folder.
2. AirDrop one `.html` file or the whole folder.
3. Open the file → full brightness → recipient scans with Camera.

`index.html` lists every card when you share the folder.

## License

MIT — see [LICENSE](LICENSE).
