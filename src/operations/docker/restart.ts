import * as z from 'zod';
import { containerTuple, defineOperation } from '../define.ts';

export const dockerRestart = defineOperation({
  name: 'docker_restart',
  cli: ['docker', 'restart'],
  title: 'Restart a container',
  description:
    'Restarts (stop with a 10s timeout, then start) an allowlisted container. Causes brief service downtime. ' +
    'Does not recreate the container or change its image or volumes. Only use when the user explicitly asks for it.',
  risk: 'write',
  surfaces: ['cli', 'mcp'],
  input: (config) => {
    const containers = containerTuple(config);
    if (!containers) return null;
    return z.object({
      container: z.enum(containers).describe('Container name (allowlisted containers only).'),
    });
  },
  async run(ctx, { container }) {
    await ctx.remote('restart', [container]);
    return { summary: `Container "${container}" restarted.` };
  },
});
