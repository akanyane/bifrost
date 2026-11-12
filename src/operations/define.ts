import type * as z from 'zod';
import type { Config, Risk, Surface } from '../core/config/schema.ts';
import type { Logger } from '../core/logger.ts';
import type { ExecResult } from '../core/ssh/types.ts';

export interface OpContext {
  config: Config;
  surface: Surface;
  logger: Logger;
  signal?: AbortSignal;
  /** Calls a bifrost-gate verb. Throws BifrostError if the gate refuses or the command fails. */
  remote(verb: string, args?: ReadonlyArray<string | number>): Promise<ExecResult>;
}

export interface OpResult {
  /** Short sentence written by Bifrost itself (trusted). */
  summary: string;
  /** Structured data derived from the server (already sanitized, but of untrusted origin). */
  data?: unknown;
  /** Raw text from the server (already sanitized, but of untrusted origin). */
  output?: { text: string; truncated: boolean };
}

export interface Operation<S extends z.ZodObject = z.ZodObject> {
  /** MCP tool name (snake_case, explicit verb). */
  name: string;
  /** CLI path: ["docker", "logs"] -> `bifrost docker logs`. */
  cli: readonly [group: string, command: string];
  title: string;
  /** Read by the model: say what it does, what it does NOT do, and its limits. */
  description: string;
  risk: Risk;
  surfaces: readonly Surface[];
  /**
   * Input schema derived from the config (e.g. z.enum(config.containers)), so the schema itself
   * tells the agent the only valid values. Returning `null` marks the operation as unavailable.
   */
  input(config: Config): S | null;
  run(ctx: OpContext, args: z.output<S>): Promise<OpResult>;
}

export function defineOperation<S extends z.ZodObject>(op: Operation<S>): Operation<S> {
  return op;
}

/** z.enum requires a non-empty tuple; returns null when the allowlist is empty. */
export function containerTuple(config: Config): [string, ...string[]] | null {
  const [first, ...rest] = config.containers;
  return first === undefined ? null : [first, ...rest];
}
