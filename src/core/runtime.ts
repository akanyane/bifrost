import { createFileAudit, type AuditLog } from './audit.ts';
import type { Config } from './config/schema.ts';
import { createLogger, type Logger } from './logger.ts';
import { RateLimiter } from './policy.ts';
import { SshSession } from './ssh/session.ts';
import type { Executor } from './ssh/types.ts';

/** Everything operations need, built once per process (CLI or MCP). */
export interface Runtime {
  config: Config;
  executor: Executor;
  logger: Logger;
  audit: AuditLog;
  /** Applied to MCP operations with risk >= write. */
  mcpWriteLimiter: RateLimiter;
  close(): void;
}

export interface RuntimeOverrides {
  executor?: Executor;
  logger?: Logger;
  audit?: AuditLog;
}

export function createRuntime(config: Config, overrides: RuntimeOverrides = {}): Runtime {
  const logger = overrides.logger ?? createLogger();
  const executor = overrides.executor ?? new SshSession(config, logger);
  return {
    config,
    executor,
    logger,
    audit: overrides.audit ?? createFileAudit(logger),
    mcpWriteLimiter: new RateLimiter(config.policy.mcp.writesPerWindow, config.policy.mcp.windowSeconds),
    close: () => executor.end(),
  };
}
