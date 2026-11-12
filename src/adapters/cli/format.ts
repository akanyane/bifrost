import type { OpResult } from '../../operations/define.ts';

/** The CLI is the only place allowed to write to stdout outside the MCP protocol. */
export function printResult(result: OpResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stderr.write(`${result.summary}\n`);

  if (Array.isArray(result.data) && result.data.every((r) => r !== null && typeof r === 'object')) {
    if (result.data.length > 0) console.table(result.data);
  } else if (result.data !== undefined) {
    process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
  }

  if (result.output) {
    process.stdout.write(result.output.text.endsWith('\n') ? result.output.text : `${result.output.text}\n`);
    if (result.output.truncated) process.stderr.write('[output truncated: raise limits.maxOutputBytes or narrow the window]\n');
  }
}
