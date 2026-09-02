export interface ParsedArgv {
  command: string;
  subcommand: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const COMMANDS_WITH_SUBCOMMAND = new Set(['config', 'db', 'provider', 'registry', 'release']);

export function parseArgv(argv: string[]): ParsedArgv {
  const tokens = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === '--') {
      rest.push(...tokens.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
        continue;
      }
      const key = token.slice(2);
      const next = tokens[index + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (token.startsWith('-') && token.length === 2) {
      const key = token.slice(1);
      const next = tokens[index + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    rest.push(token);
  }

  const command = rest[0] ?? 'help';
  let subcommand: string | null = null;
  let positionals = rest.slice(1);
  if (COMMANDS_WITH_SUBCOMMAND.has(command) && positionals[0] && !positionals[0].startsWith('-')) {
    subcommand = positionals[0]!;
    positionals = positionals.slice(1);
  }
  if (flags.help === true || flags.h === true) {
    return { command: command === 'help' ? 'help' : command, subcommand, positionals, flags: { ...flags, help: true } };
  }
  return { command, subcommand, positionals, flags };
}

export function flagString(flags: Record<string, string | boolean>, name: string, fallback = ''): string {
  const value = flags[name];
  return typeof value === 'string' ? value : fallback;
}

export function flagBoolean(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true' || flags[name] === '1';
}
