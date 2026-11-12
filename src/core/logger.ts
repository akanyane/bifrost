/**
 * Bifrost logger. It ALWAYS writes to stderr: in MCP mode stdout is the JSON-RPC channel
 * and a single stray byte there breaks the session. Never write to stdout from core/operations.
 */
export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = keyof typeof LEVELS;

export function createLogger(level: string = process.env.BIFROST_LOG ?? 'info'): Logger {
  const min = LEVELS[(level in LEVELS ? level : 'info') as Level];
  const write = (lvl: Exclude<Level, 'silent'>, msg: string) => {
    if (LEVELS[lvl] >= min) process.stderr.write(`[bifrost] ${lvl}: ${msg}\n`);
  };
  return {
    debug: (m) => write('debug', m),
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
