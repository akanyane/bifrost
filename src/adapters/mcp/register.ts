import type { McpServer } from '@modelcontextprotocol/server';
import type { Risk } from '../../core/config/schema.ts';
import { errorMessage } from '../../core/errors.ts';
import { isAllowed } from '../../core/policy.ts';
import type { Runtime } from '../../core/runtime.ts';
import type { OpResult, Operation } from '../../operations/define.ts';
import { execute } from '../../operations/execute.ts';
import { registry } from '../../operations/registry.ts';

/**
 * Annotations are HINTS clients use to decide when to ask for human confirmation; they are not a
 * security control. "write" is flagged as destructive because a restart takes the service down,
 * which makes clients like Claude and Cursor ask for approval.
 */
function annotationsFor(risk: Risk) {
  switch (risk) {
    case 'read':
      return { readOnlyHint: true, openWorldHint: false };
    case 'write':
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
    case 'destructive':
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  }
}

/** Everything that came from the server is fenced so the model treats it as data, not instructions. */
function toToolResult(op: Operation, result: OpResult) {
  const parts = [result.summary];
  const untrusted: string[] = [];
  if (result.data !== undefined) untrusted.push(JSON.stringify(result.data, null, 2));
  if (result.output) {
    untrusted.push(result.output.text);
    if (result.output.truncated) untrusted.push('[... output truncated by Bifrost ...]');
  }
  if (untrusted.length > 0) {
    parts.push(`<untrusted_output source="${op.name}">\n${untrusted.join('\n')}\n</untrusted_output>`);
  }
  return { content: [{ type: 'text' as const, text: parts.join('\n\n') }] };
}

export function registerTools(server: McpServer, rt: Runtime): string[] {
  const registered: string[] = [];

  for (const op of registry) {
    if (!isAllowed(rt.config, 'mcp', op)) {
      rt.logger.debug(`tool "${op.name}" skipped (risk ${op.risk} > policy.mcp.maxRisk)`);
      continue;
    }
    const inputSchema = op.input(rt.config);
    if (!inputSchema) {
      rt.logger.debug(`tool "${op.name}" skipped (unavailable with the current config)`);
      continue;
    }

    server.registerTool(
      op.name,
      {
        title: op.title,
        description: op.description,
        inputSchema,
        annotations: annotationsFor(op.risk),
      },
      async (args: unknown, ctx) => {
        try {
          return toToolResult(op, await execute(op, args, rt, 'mcp', ctx.mcpReq.signal));
        } catch (err) {
          return { content: [{ type: 'text' as const, text: errorMessage(err) }], isError: true };
        }
      },
    );
    registered.push(op.name);
  }

  return registered;
}
