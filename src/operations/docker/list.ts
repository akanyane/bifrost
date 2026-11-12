import * as z from 'zod';
import { sanitizeField } from '../../core/sanitize.ts';
import { defineOperation } from '../define.ts';

export const dockerListContainers = defineOperation({
  name: 'docker_list_containers',
  cli: ['docker', 'ps'],
  title: 'List containers',
  description:
    'Lists the Docker containers on the server (running and stopped) with name, image, state and status. ' +
    'The "managed" field tells whether the container is in the Bifrost allowlist: only those accept logs/restart. Read-only.',
  risk: 'read',
  surfaces: ['cli', 'mcp'],
  input: () => z.object({}),
  async run(ctx) {
    const res = await ctx.remote('ps');
    const containers = res.stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          const row = JSON.parse(line) as Record<string, unknown>;
          const name = sanitizeField(row.Names, 128);
          return [
            {
              name,
              image: sanitizeField(row.Image),
              state: sanitizeField(row.State, 32),
              status: sanitizeField(row.Status, 80),
              managed: ctx.config.containers.includes(name),
            },
          ];
        } catch {
          ctx.logger.warn('ignored an unexpected line from docker ps');
          return [];
        }
      });
    const running = containers.filter((c) => c.state === 'running').length;
    return {
      summary: `${containers.length} container(s), ${running} running.${res.truncated ? ' (output truncated)' : ''}`,
      data: containers,
    };
  },
});
