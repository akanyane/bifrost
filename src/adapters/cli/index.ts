import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { defaultConfigPath, loadConfig } from '../../core/config/load.ts';
import type { Config } from '../../core/config/schema.ts';
import { BifrostError, errorMessage } from '../../core/errors.ts';
import { buildGateCommand } from '../../core/gate.ts';
import { defaultStorePath } from '../../core/store.ts';
import { isAllowed } from '../../core/policy.ts';
import { createRuntime } from '../../core/runtime.ts';
import { execute } from '../../operations/execute.ts';
import { registry } from '../../operations/registry.ts';
import { VERSION } from '../../version.ts';
import { registerConnectionCommands } from './connect.ts';
import { printResult } from './format.ts';
import { optionsFromSchema } from './zod-to-options.ts';

/** Operation schemas depend on the config (allowlist), so it is read before building the commands. */
function configPathFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-c' || a === '--config') return argv[i + 1];
    if (a.startsWith('--config=')) return a.slice('--config='.length);
  }
  return undefined;
}

async function withRuntime<T>(config: Config, fn: (rt: ReturnType<typeof createRuntime>) => Promise<T>): Promise<T> {
  const rt = createRuntime(config);
  try {
    return await fn(rt);
  } finally {
    rt.close();
  }
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const configPath = configPathFromArgv(argv) ?? defaultConfigPath();
  let config: Config | undefined;
  let configError: unknown;
  try {
    config = await loadConfig(configPath);
  } catch (err) {
    configError = err;
  }
  const requireConfig = (): Config => {
    if (config) return config;
    throw configError;
  };

  const program = new Command('bifrost')
    .version(VERSION)
    .description('Operate an Ubuntu server over SSH through scoped operations. Also runs as an MCP server (`bifrost mcp`).')
    .option('-c, --config <path>', 'config file', configPath)
    .option('--json', 'JSON output (for scripts)')
    .showHelpAfterError();

  registerConnectionCommands(program);

  program
    .command('mcp')
    .description('Start the MCP server on stdio (for Claude Desktop, Cursor, etc.)')
    .action(async () => {
      const { startMcp } = await import('../mcp/server.ts');
      await startMcp(configPath);
    });

  program
    .command('doctor')
    .description('Check config, host key, authentication and the bifrost-gate on the server')
    .action(async () => {
      const cfg = requireConfig();
      process.stderr.write(
        existsSync(configPath) ? `config: ${configPath} ✓\n` : 'config: no file, using the saved connection defaults ✓\n',
      );
      if (cfg.auth.method === 'password') process.stderr.write(`auth: password from ${defaultStorePath()}\n`);
      await withRuntime(cfg, async (rt) => {
        const res = await rt.executor.exec(buildGateCommand('ping'), { timeoutMs: cfg.limits.timeoutMs, maxBytes: 1024 });
        process.stderr.write(`ssh: ${cfg.server.username}@${cfg.server.host} (host key ${cfg.server.fingerprint}) ✓\n`);
        if (res.code !== 0 || res.stdout.trim() !== 'pong') {
          throw new BifrostError(
            `bifrost-gate did not answer "pong" (exit ${res.code}): ${(res.stderr || res.stdout).trim().slice(0, 300)}. See remote/install.md.`,
            'REMOTE_FAILED',
          );
        }
        process.stderr.write('gate: pong ✓\n');
      });
    });

  program
    .command('config-path')
    .description('Print the path of the config in use')
    .action(() => {
      process.stdout.write(`${configPath}\n`);
    });

  const groups = new Map<string, Command>();
  for (const op of registry) {
    const [groupName, cmdName] = op.cli;
    let group = groups.get(groupName);
    if (!group) {
      group = program.command(groupName).description(`${groupName} operations`);
      groups.set(groupName, group);
    }

    const cmd = group.command(cmdName).description(`${op.title} [${op.risk}]`);
    const schema = config ? op.input(config) : null;
    if (schema) {
      for (const opt of optionsFromSchema(schema)) cmd.addOption(opt);
    } else {
      cmd.allowUnknownOption();
    }
    if (config && !isAllowed(config, 'cli', op)) cmd.description(`${op.title} [${op.risk}, blocked by policy]`);

    cmd.action(async (opts: Record<string, unknown>) => {
      const cfg = requireConfig();
      const json = Boolean(program.opts().json);
      const result = await withRuntime(cfg, (rt) => execute(op, opts, rt, 'cli'));
      printResult(result, json);
    });
  }

  try {
    await program.parseAsync(argv);
  } catch (err) {
    process.stderr.write(`${errorMessage(err)}\n`);
    process.exitCode = 1;
  }
}
