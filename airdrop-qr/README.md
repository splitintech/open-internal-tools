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


## SplitIn Dev tools integration

Hosted route: `https://www.splitin.net/dev-tools/qr-generator` (deployment qualification tracked by the host application). Build with Node 24, `npm ci`, `npm run build`, then `npm test`. Consumers install reviewed versioned tarballs; no sibling-source imports are required.

The hosted playground is isolated from customer verification, onboarding and payment eligibility. Public demonstrations keep state in memory and suppress recording. Provider credentials and launch secrets must never be persisted by a browser client. Test keyboard controls, 320/390/768px layouts and reduced motion as well as physical iOS Safari and Android Chrome.

### Browser exports (0.2)

Import `parseCatalogText`, `catalogErrors`, `generateAssets` and `svgToPng` from `@splitin/airdrop-qr/browser`. JSON uses the existing catalog format. CSV requires `slug,label,url` and optional `blurb`, with UTF-8, quoted commas and quoted newlines supported. Limits: 5 MB input, 250 entries, HTTPS destinations without credentials. Theme values accept only #RGB/#RRGGBB. QR pixels stay dark on white; PNG is 1024px. Pass `signal` and `onProgress(completed,total)` to generation. All assets remain in memory; the CLI retains its filesystem output and 320px SVG markup. HTML works offline and contains no scripts or remote fonts.
