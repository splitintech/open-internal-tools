# SEO.md

Per-route adder. All required before `/done` and `/ack seo_index`:

- [ ] `config/seo/route-policy.mjs` row
- [ ] `src/App.tsx` route
- [ ] `npm run generate:sitemap`
- [ ] `scripts/seo/generate-html-shells.mjs` crawler HTML (`main` `header` `section` `article` `h1`–`h3` `p` `ul` `a`)
- [ ] regenerate `publicRoutes.generated.ts`
- [ ] `npm run check:sitemap`
- Auth routes stay `app-shell.html`

Routes:
