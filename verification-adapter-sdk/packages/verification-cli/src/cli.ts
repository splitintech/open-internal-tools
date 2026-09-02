import { pathToFileURL } from 'node:url';

import { parseArgv } from './argv.ts';
import { dispatch, type CommandResult } from './commands.ts';

export { parseArgv } from './argv.ts';
export { dispatch } from './commands.ts';
export { redactSecrets, redactValue } from './redact.ts';
export { defaultConfig } from './config.ts';

export async function run(argv: string[] = process.argv): Promise<CommandResult> {
  const parsed = parseArgv(argv);
  return dispatch(parsed);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMain) {
  void run().then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const parsed = parseArgv(process.argv);
    if (parsed.command === 'dev' && parsed.flags['print-only'] !== true && result.exitCode === 0) {
      return;
    }
    process.exit(result.exitCode);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown CLI failure.';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
