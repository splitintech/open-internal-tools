# Supabase Edge Functions + PostgreSQL

Edge Function handler that talks to Postgres through an injected client. The
adapter does not read `Deno.env` or open a connection pool.

Production routes stay disabled. Enable them only after sandbox certification
and a dedicated production project.

```bash
cd examples/supabase-edge
node --experimental-strip-types src/index.ts
```
