// One worker pass per Papr job run: poll mailboxes, apply replies/opt-outs, reconcile, send what is due.
// The engine keeps its own database outside Papr's registry (ADR 0004). Provider adapters come from
// outreach.config.mjs next to that database; secrets arrive as env vars declared on the job.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { main } from '@splitin/outreach-cli';

const home = process.env.OUTREACH_HOME ?? join(process.env.PAPR_HOME ?? join(homedir(), 'Papr'), 'outreach');
const env = { ...process.env, OUTREACH_DB: process.env.OUTREACH_DB ?? join(home, 'outreach.db') };
const config = join(home, 'outreach.config.mjs');
if (!existsSync(env.OUTREACH_DB)) {
  console.error(`No outreach database at ${env.OUTREACH_DB}. Run \`outreach init\` first (see the Outreach Console README).`);
  process.exit(1);
}
const code = await main(['worker', '--once', '--json', ...(existsSync(config) ? ['--config', config] : [])], { env });
process.exit(code);
