import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod';
import { BifrostError } from '../errors.ts';
import { ConfigSchema, type Config } from './schema.ts';

export function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

export function defaultConfigPath(): string {
  if (process.env.BIFROST_CONFIG) return expandHome(process.env.BIFROST_CONFIG);
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'bifrost', 'config.json');
}

export async function loadConfig(path: string = defaultConfigPath()): Promise<Config> {
  const file = expandHome(path);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    throw new BifrostError(
      `Config not found at ${file}. Copy config.example.json there (or use --config / BIFROST_CONFIG).`,
      'CONFIG',
      { cause },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new BifrostError(`Config at ${file} is not valid JSON.`, 'CONFIG', { cause });
  }

  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new BifrostError(`Invalid config (${file}):\n${z.prettifyError(parsed.error)}`, 'CONFIG');
  }
  return parsed.data;
}
