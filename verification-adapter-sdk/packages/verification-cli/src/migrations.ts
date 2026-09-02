import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { VerificationCliConfig } from './config.ts';

export interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
}

const MIGRATION_FILES = [
  { version: '001', name: 'init' },
  { version: '002', name: 'seed' },
  { version: '003', name: 'retention' },
] as const;

function migrationsDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'migrations'),
    join(here, '..', '..', 'verification-postgres', 'migrations'),
  ];
  for (const directory of candidates) {
    if (existsSync(join(directory, '001_init.sql'))) return directory;
  }
  throw new Error('Bundled verification SQL migrations were not found.');
}

function loadBundledMigrations(): Migration[] {
  const directory = migrationsDirectory();
  return MIGRATION_FILES.map((item) => ({
    version: item.version,
    name: item.name,
    up: readFileSync(join(directory, `${item.version}_${item.name}.sql`), 'utf8'),
    down: readFileSync(join(directory, `${item.version}_${item.name}.down.sql`), 'utf8'),
  }));
}

export const bundledMigrations: Migration[] = loadBundledMigrations();

const STATE_FILE = '.verification/migrations-state.json';

interface MigrationState {
  applied: string[];
}

function statePath(cwd: string): string {
  return join(cwd, STATE_FILE);
}

function readState(cwd: string): MigrationState {
  const path = statePath(cwd);
  if (!existsSync(path)) return { applied: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as MigrationState;
}

function writeState(cwd: string, state: MigrationState): void {
  mkdirSync(join(cwd, '.verification'), { recursive: true });
  writeFileSync(statePath(cwd), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function writeMigrationFiles(cwd: string, config: VerificationCliConfig): string {
  const directory = join(cwd, config.database.migrationsDirectory);
  mkdirSync(directory, { recursive: true });
  for (const migration of bundledMigrations) {
    writeFileSync(join(directory, `${migration.version}_${migration.name}.up.sql`), migration.up, 'utf8');
    writeFileSync(join(directory, `${migration.version}_${migration.name}.down.sql`), migration.down, 'utf8');
  }
  return directory;
}

export function migrateUp(cwd: string, config: VerificationCliConfig): { applied: string[]; sql: string[] } {
  writeMigrationFiles(cwd, config);
  const state = readState(cwd);
  const applied: string[] = [];
  const sql: string[] = [];
  for (const migration of bundledMigrations) {
    if (state.applied.includes(migration.version)) continue;
    sql.push(migration.up);
    state.applied.push(migration.version);
    applied.push(`${migration.version}_${migration.name}`);
  }
  writeState(cwd, state);
  return { applied, sql };
}

export function migrateDown(cwd: string, config: VerificationCliConfig): { rolledBack: string | null; sql: string[] } {
  writeMigrationFiles(cwd, config);
  const state = readState(cwd);
  const version = state.applied.at(-1);
  if (!version) return { rolledBack: null, sql: [] };
  const migration = bundledMigrations.find((item) => item.version === version);
  if (!migration) return { rolledBack: null, sql: [] };
  state.applied = state.applied.filter((item) => item !== version);
  writeState(cwd, state);
  return { rolledBack: `${migration.version}_${migration.name}`, sql: [migration.down] };
}

export function appliedMigrations(cwd: string): string[] {
  return readState(cwd).applied;
}

export function listedMigrationFiles(cwd: string, config: VerificationCliConfig): string[] {
  const directory = join(cwd, config.database.migrationsDirectory);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
}
