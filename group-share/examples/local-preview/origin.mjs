#!/usr/bin/env node
import { createServer } from "node:http";

const port = Number(process.env.ORIGIN_PORT ?? 4010);
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("origin-ok\n");
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`origin on 127.0.0.1:${port}\n`);
});
