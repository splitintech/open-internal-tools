# Hono worker

A Cloudflare-style worker handler that receives an **injected durable store**.
The adapter never opens KV, D1, or a database itself.

Production routes stay disabled. `/production/*` returns 403.

```bash
cd examples/hono-worker
node --experimental-strip-types src/worker.ts
```
