import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod';
import { BifrostError } from '../errors.ts';
import { CredentialStore, defaultStorePath, type Connection } from '../store.ts';
import { ConfigSchema, type Config } from './schema.ts';

export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

export function defaultConfigPath(): string {
  if (process.env.BIFROST_CONFIG) return expandHome(process.env.BIFROST_CONFIG);
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'bifrost', 'config.json');
}

/** Active connection saved by `bifrost connect`, if any. Never creates the database. */
export function readActiveConnection(storePath: string = defaultStorePath()): Connection | undefined {
  if (!existsSync(storePath)) return undefined;
  const store = CredentialStore.open(storePath);
  try {
    return store.active();
  } finally {
    store.close();
  }
}

/** `server` and `auth` from the active connection replace whatever the config file says. */
export function applyConnection(json: Record<string, unknown>, conn: Connection): Record<string, unknown> {
  return {
    ...json,
    server: {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      hostKeyAlgorithm: conn.hostKeyAlgorithm,
      fingerprint: conn.fingerprint,
    },
    auth: { method: 'password', password: conn.password },
  };
}

export async function loadConfig(
  path: string = defaultConfigPath(),
  storePath: string = defaultStorePath(),
): Promise<Config> {
  const file = expandHome(path);
  const conn = readActiveConnection(storePath);

  let json: Record<string, unknown> = {};
  let raw: string | undefined;
  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    if (!conn) {
      throw new BifrostError(
        `No connection and no config at ${file}. Run \`bifrost connect --ip <host> --user <user>\` ` +
          '(or copy config.example.json there / use --config / BIFROST_CONFIG).',
        'CONFIG',
        { cause },
      );
    }
  }

  if (raw !== undefined) {
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new BifrostError(`Config at ${file} is not valid JSON.`, 'CONFIG', { cause });
    }
    const auth = (json as { auth?: { method?: unknown } }).auth;
    if (auth?.method === 'password') {
      throw new BifrostError(
        `Config at ${file}: auth.method "password" is not allowed in the config file. Use \`bifrost connect\`, which keeps it in the local store.`,
        'CONFIG',
      );
    }
  }

  if (conn) json = applyConnection(json, conn);

  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new BifrostError(`Invalid config (${file}):\n${z.prettifyError(parsed.error)}`, 'CONFIG');
  }
  return parsed.data;
}
