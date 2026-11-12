import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Surface } from './config/schema.ts';
import type { Logger } from './logger.ts';

export interface AuditEntry {
  surface: Surface;
  op: string;
  args: unknown;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

export function defaultAuditPath(): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'bifrost', 'audit.jsonl');
}

/** One JSON line per call. A failure to audit never breaks the operation, but it is logged. */
export function createFileAudit(logger: Logger, path: string = defaultAuditPath()): AuditLog {
  let ready: Promise<unknown> | undefined;
  return {
    async record(entry) {
      try {
        ready ??= mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await ready;
        await appendFile(path, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
      } catch (err) {
        logger.warn(`failed to write audit log to ${path}: ${(err as Error).message}`);
      }
    },
  };
}

export const noopAudit: AuditLog = { async record() {} };
