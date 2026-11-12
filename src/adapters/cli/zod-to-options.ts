import { InvalidArgumentError, Option } from 'commander';
import * as z from 'zod';

interface JsonProp {
  type?: string;
  enum?: string[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Builds Commander flags from the SAME Zod schema the MCP server exposes.
 * Final validation still happens against the schema in execute().
 */
export function optionsFromSchema(schema: z.ZodObject): Option[] {
  const json = z.toJSONSchema(schema, { io: 'input' }) as {
    properties?: Record<string, JsonProp>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);

  return Object.entries(json.properties ?? {}).map(([key, prop]) => {
    const isBool = prop.type === 'boolean';
    const placeholder = prop.enum ? 'name' : prop.type === 'integer' ? 'n' : 'value';
    const flag = isBool ? `--${kebab(key)}` : `--${kebab(key)} <${placeholder}>`;
    const opt = new Option(flag, prop.description ?? '');

    if (prop.enum) opt.choices(prop.enum);
    if (prop.type === 'integer' || prop.type === 'number') {
      opt.argParser((raw: string) => {
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new InvalidArgumentError('must be a number.');
        return n;
      });
    }
    if (prop.default !== undefined) opt.default(prop.default);
    if (required.has(key) && prop.default === undefined) opt.makeOptionMandatory();
    return opt;
  });
}
