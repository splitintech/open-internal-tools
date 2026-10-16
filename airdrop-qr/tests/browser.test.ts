import { describe, it, expect } from 'vitest';
import { parseCatalogText, generateAssets, catalogErrors } from '../src/browser';
const catalog = { brand: 'Brand', entries: [{ slug: 'one', label: '<script>alert(1)</script>', url: 'https://example.com/猫?q=hello' }] };
describe('browser boundary', () => {
  it('parses quoted Unicode CSV and CRLF', () => { const result = parseCatalogText('slug,label,url,blurb\r\none,"猫, hello",https://example.com/,"a ""quote""\nand a newline"', 'csv'); expect(result.entries[0].label).toBe('猫, hello'); expect(result.entries[0].blurb).toContain('"quote"\nand'); });
  it('collects duplicate and entry errors before generation', () => { expect(catalogErrors({ ...catalog, entries: [catalog.entries[0], catalog.entries[0], { slug: 'bad', label: 'Bad', url: 'javascript:alert(1)' }] })).toHaveLength(2); });
  it('rejects CSS injection and credential URLs', async () => { await expect(generateAssets({ ...catalog, accent: '#fff; background:url(https://evil.test)' })).rejects.toThrow('hex color'); expect(() => parseCatalogText(JSON.stringify({ ...catalog, entries: [{ ...catalog.entries[0], url: 'https://user:pass@example.com' }] }), 'json')).toThrow('credentials'); });
  it('escapes HTML, encodes UTM and fixes QR contrast', async () => { const kit = await generateAssets({ ...catalog, ink: '#ffffff', utm: { source: 'a & b', medium: 'QR' } }); expect(kit.cards[0].html).not.toContain('<script>'); expect(kit.cards[0].svg).toContain('#111111'); expect(new URL(kit.cards[0].destination).searchParams.get('utm_campaign')).toBe('one'); });
  it('enforces 250 entries and cancels before more work', async () => { await expect(generateAssets({ ...catalog, entries: Array.from({length:251}, (_, i) => ({ ...catalog.entries[0], slug: `item-${i}` })) })).rejects.toThrow('250'); const controller = new AbortController(); controller.abort(); await expect(generateAssets(catalog, { signal: controller.signal })).rejects.toThrow(); });
});
