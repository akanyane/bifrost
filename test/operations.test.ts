import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BifrostError } from '../src/core/errors.ts';
import { dockerListContainers } from '../src/operations/docker/list.ts';
import { dockerLogs } from '../src/operations/docker/logs.ts';
import { dockerRestart } from '../src/operations/docker/restart.ts';
import { execute } from '../src/operations/execute.ts';
import { testConfig, testRuntime } from './helpers.ts';

const isCode = (code: string) => (e: unknown) => e instanceof BifrostError && e.code === code;

describe('execute', () => {
  it('docker_logs applies the tail default and only sends the token protocol', async () => {
    const { rt, executor, audits } = testRuntime();
    executor.next = { stdout: '2026-01-01T00:00:00Z hello\nTOKEN=abc\n' };
    const res = await execute(dockerLogs, { container: 'web' }, rt, 'mcp');
    assert.equal(executor.calls[0]?.command, 'bifrost-gate logs web 100');
    assert.match(res.output!.text, /TOKEN=\*\*\*/);
    assert.equal(audits[0]?.ok, true);
  });

  it('rejects non-allowlisted containers before touching SSH', async () => {
    const { rt, executor, audits } = testRuntime();
    await assert.rejects(execute(dockerLogs, { container: 'postgres' }, rt, 'mcp'), isCode('INVALID_INPUT'));
    await assert.rejects(execute(dockerLogs, { container: 'web; reboot' }, rt, 'mcp'), isCode('INVALID_INPUT'));
    await assert.rejects(execute(dockerLogs, { container: 'web', tail: 100_000 }, rt, 'mcp'), isCode('INVALID_INPUT'));
    assert.equal(executor.calls.length, 0);
    assert.equal(audits.length, 3);
    assert.ok(audits.every((a) => !a.ok));
  });

  it('docker_restart is blocked on MCP by the default policy but allowed on the CLI', async () => {
    const { rt, executor } = testRuntime();
    await assert.rejects(execute(dockerRestart, { container: 'web' }, rt, 'mcp'), isCode('POLICY_DENIED'));
    assert.equal(executor.calls.length, 0);
    await execute(dockerRestart, { container: 'web' }, rt, 'cli');
    assert.equal(executor.calls[0]?.command, 'bifrost-gate restart web');
  });

  it('rate-limits MCP writes when they are enabled', async () => {
    const config = testConfig({ policy: { mcp: { maxRisk: 'write', writesPerWindow: 1 } } });
    const { rt } = testRuntime(config);
    await execute(dockerRestart, { container: 'web' }, rt, 'mcp');
    await assert.rejects(execute(dockerRestart, { container: 'web' }, rt, 'mcp'), isCode('RATE_LIMITED'));
  });

  it('operations are unavailable with an empty allowlist', async () => {
    const { rt } = testRuntime(testConfig({ containers: [] }));
    assert.equal(dockerLogs.input(rt.config), null);
    await assert.rejects(execute(dockerLogs, { container: 'web' }, rt, 'cli'), isCode('UNAVAILABLE'));
  });

  it('maps gate exit 126 to GATE_DENIED', async () => {
    const { rt, executor } = testRuntime();
    executor.next = { code: 126, stderr: 'bifrost-gate: container not in allowlist: web' };
    await assert.rejects(execute(dockerLogs, { container: 'web' }, rt, 'cli'), isCode('GATE_DENIED'));
  });

  it('docker_list_containers sanitizes fields and flags managed', async () => {
    const { rt, executor } = testRuntime();
    executor.next = {
      stdout: [
        JSON.stringify({ Names: 'web', Image: 'nginx:1', State: 'running', Status: 'Up 2 hours' }),
        JSON.stringify({ Names: 'evil\x1b[2J', Image: 'x', State: 'exited', Status: 'Exited (0)' }),
        'garbage',
      ].join('\n'),
    };
    const res = await execute(dockerListContainers, {}, rt, 'mcp');
    assert.deepEqual(res.data, [
      { name: 'web', image: 'nginx:1', state: 'running', status: 'Up 2 hours', managed: true },
      { name: 'evil', image: 'x', state: 'exited', status: 'Exited (0)', managed: false },
    ]);
  });
});
