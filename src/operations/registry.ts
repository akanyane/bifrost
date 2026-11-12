import type { Operation } from './define.ts';
import { dockerListContainers } from './docker/list.ts';
import { dockerLogs } from './docker/logs.ts';
import { dockerRestart } from './docker/restart.ts';
import { systemOverview } from './system/overview.ts';

/**
 * Single source of truth: each operation is defined once and both adapters (CLI and MCP) are
 * generated from this list. To add an operation: create its file, register it here, and add
 * the matching verb to remote/bifrost-gate.sh.
 */
export const registry: ReadonlyArray<Operation<any>> = [systemOverview, dockerListContainers, dockerLogs, dockerRestart];
