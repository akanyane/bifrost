import * as z from 'zod';
import { sanitize } from '../../core/sanitize.ts';
import { containerTuple, defineOperation } from '../define.ts';

export const dockerLogs = defineOperation({
  name: 'docker_logs',
  cli: ['docker', 'logs'],
  title: 'Read container logs',
  description:
    'Returns the last log lines (stdout+stderr, with timestamps) of an allowlisted container. ' +
    'No streaming: use "tail" (max 500) and "sinceMinutes" (max 1440) to narrow the window. ' +
    'Obvious secrets are masked. Read-only.',
  risk: 'read',
  surfaces: ['cli', 'mcp'],
  input: (config) => {
    const containers = containerTuple(config);
    if (!containers) return null;
    return z.object({
      container: z.enum(containers).describe('Container name (allowlisted containers only).'),
      tail: z.number().int().min(1).max(500).default(100).describe('Number of trailing lines.'),
      sinceMinutes: z.number().int().min(1).max(1440).optional().describe('Only logs from the last N minutes.'),
    });
  },
  async run(ctx, { container, tail, sinceMinutes }) {
    const args: Array<string | number> = [container, tail];
    if (sinceMinutes !== undefined) args.push(sinceMinutes);
    const res = await ctx.remote('logs', args);
    const text = sanitize(res.stdout);
    const lines = text === '' ? 0 : text.trimEnd().split('\n').length;
    return {
      summary: `${lines} log line(s) from "${container}"${sinceMinutes ? ` (last ${sinceMinutes} min)` : ''}.`,
      output: { text, truncated: res.truncated },
    };
  },
});
