import * as z from 'zod';
import { sanitize } from '../../core/sanitize.ts';
import { defineOperation } from '../define.ts';

export const systemOverview = defineOperation({
  name: 'system_overview',
  cli: ['system', 'overview'],
  title: 'Server overview',
  description: 'Server summary: hostname, uptime, load average, memory, disk usage and number of running containers. Read-only.',
  risk: 'read',
  surfaces: ['cli', 'mcp'],
  input: () => z.object({}),
  async run(ctx) {
    const res = await ctx.remote('overview');
    return {
      summary: 'Server overview.',
      output: { text: sanitize(res.stdout), truncated: res.truncated },
    };
  },
});
