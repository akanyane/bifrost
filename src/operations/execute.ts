import * as z from 'zod';
import type { Surface } from '../core/config/schema.ts';
import { BifrostError, errorMessage } from '../core/errors.ts';
import { buildGateCommand } from '../core/gate.ts';
import { assertAllowed } from '../core/policy.ts';
import type { Runtime } from '../core/runtime.ts';
import { sanitize } from '../core/sanitize.ts';
import type { OpContext, OpResult, Operation } from './define.ts';

/**
 * The single execution path for both CLI and MCP: policy -> validation -> rate limit -> run -> audit.
 * Adapters never call op.run directly.
 */
export async function execute(
  op: Operation,
  rawArgs: unknown,
  rt: Runtime,
  surface: Surface,
  signal?: AbortSignal,
): Promise<OpResult> {
  const started = Date.now();
  let args: unknown = rawArgs;

  try {
    assertAllowed(rt.config, surface, op);

    const schema = op.input(rt.config);
    if (!schema) {
      throw new BifrostError(`"${op.name}" is unavailable with the current config (e.g. empty container allowlist).`, 'UNAVAILABLE');
    }

    // Validate again even when the MCP SDK already did: the core does not trust the adapter.
    const parsed = schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      throw new BifrostError(`Invalid arguments for "${op.name}":\n${z.prettifyError(parsed.error)}`, 'INVALID_INPUT');
    }
    args = parsed.data;

    if (surface === 'mcp' && op.risk !== 'read') rt.mcpWriteLimiter.take(op.name);

    const result = await op.run(createContext(rt, surface, signal), parsed.data);
    await rt.audit.record({ surface, op: op.name, args, ok: true, durationMs: Date.now() - started });
    return result;
  } catch (err) {
    await rt.audit.record({
      surface,
      op: op.name,
      args,
      ok: false,
      durationMs: Date.now() - started,
      error: errorMessage(err),
    });
    throw err;
  }
}

function createContext(rt: Runtime, surface: Surface, signal?: AbortSignal): OpContext {
  return {
    config: rt.config,
    surface,
    logger: rt.logger,
    ...(signal ? { signal } : {}),
    async remote(verb, args = []) {
      const command = buildGateCommand(verb, args);
      rt.logger.debug(`remote: ${command}`);
      const res = await rt.executor.exec(command, {
        timeoutMs: rt.config.limits.timeoutMs,
        maxBytes: rt.config.limits.maxOutputBytes,
        ...(signal ? { signal } : {}),
      });
      const detail = () => sanitize(res.stderr || res.stdout).trim().slice(0, 500);
      if (res.code === 126) throw new BifrostError(`The gate refused "${verb}": ${detail()}`, 'GATE_DENIED');
      if (res.code !== 0 && !res.truncated) {
        throw new BifrostError(`Remote command "${verb}" failed (exit ${res.code}): ${detail()}`, 'REMOTE_FAILED');
      }
      return res;
    },
  };
}
