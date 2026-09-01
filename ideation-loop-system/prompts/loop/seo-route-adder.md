# loop.seo-route-adder

Project {{project_id}} / {{goal}}.

Per-route adder. Required before `/done` and `/ack seo_index`:

- `config/seo/route-policy.mjs` row
- `src/App.tsx` route
- `npm run generate:sitemap`
- `scripts/seo/generate-html-shells.mjs` crawler HTML (`main` `header` `section` `article` `h1`–`h3` `p` `ul` `a`)
- regenerate `publicRoutes.generated.ts`
- `npm run check:sitemap` (half-written public routes MUST fail)

**Limited public/signup view.** Marketing/crawler HTML is the limited surface. After signup, users may upload more; those routes stay `app-shell.html` and are not indexed.

Spawn via `route peer=claude runtime=ide promptId=loop.seo-route-adder`. Write SEO.md.
