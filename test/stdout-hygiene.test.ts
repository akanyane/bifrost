import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

// In MCP mode stdout is the JSON-RPC channel. Core, operations and the MCP adapter must never write to it.
const root = fileURLToPath(new URL('../src/', import.meta.url));
const guarded = ['core', 'operations', 'adapters/mcp'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

it('no console.* or process.stdout in core/operations/adapters/mcp', () => {
  const offenders: string[] = [];
  for (const sub of guarded) {
    for (const file of walk(join(root, sub))) {
      const src = readFileSync(file, 'utf8');
      if (/\bconsole\.(log|info|debug|table|dir)\b|process\.stdout/.test(src)) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});
