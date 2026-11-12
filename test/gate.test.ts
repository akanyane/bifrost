import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

// Runs the real bifrost-gate.sh, only swapping the docker path (for a fake that echoes its
// arguments) and the allowlist path. This tests the boundary that actually runs on the server.
describe('remote/bifrost-gate.sh', () => {
  let dir: string;
  let gate: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'bifrost-gate-'));
    const fakeDocker = join(dir, 'docker');
    writeFileSync(fakeDocker, '#!/bin/sh\necho "DOCKER $*"\n');
    chmodSync(fakeDocker, 0o755);
    const allowlist = join(dir, 'containers');
    writeFileSync(allowlist, 'web\napi\n');

    const src = readFileSync(new URL('../remote/bifrost-gate.sh', import.meta.url), 'utf8')
      .replace(/^DOCKER=.*$/m, `DOCKER=${fakeDocker}`)
      .replace(/^ALLOWLIST=.*$/m, `ALLOWLIST=${allowlist}`);
    gate = join(dir, 'bifrost-gate');
    writeFileSync(gate, src);
    chmodSync(gate, 0o755);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (cmd: string) => {
    const r = spawnSync('bash', [gate], { env: { SSH_ORIGINAL_COMMAND: cmd }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };

  it('ping', () => assert.deepEqual(run('bifrost-gate ping'), { code: 0, out: 'pong', err: '' }));

  it('accepts the command with or without the bifrost-gate prefix', () => {
    assert.equal(run('ps').out, 'DOCKER ps --all --no-trunc --format {{json .}}');
    assert.equal(run('bifrost-gate ps').code, 0);
  });

  it('logs with allowlist and limits', () => {
    assert.equal(run('bifrost-gate logs web 50').out, 'DOCKER logs --timestamps --tail 50 web');
    assert.equal(run('bifrost-gate logs api 007 30').out, 'DOCKER logs --timestamps --tail 7 --since 30m api');
  });

  it('restart', () => assert.equal(run('bifrost-gate restart web').out, 'DOCKER restart -t 10 web'));

  const denied: Array<[string, number]> = [
    ['bifrost-gate logs postgres 10', 126], // not in allowlist
    ['bifrost-gate restart postgres', 126],
    ['bifrost-gate exec web sh', 126], // unknown verb
    ['', 126],
    ['rm -rf /', 2], // "/" is a disallowed character
    ['bifrost-gate logs web 10; reboot', 2],
    ['bifrost-gate logs web $(id)', 2],
    ['bifrost-gate logs web 10 | sh', 2],
    ['bifrost-gate logs web 9999', 2], // tail above the limit
    ['bifrost-gate logs web 0', 2],
    ['bifrost-gate logs web 10 99999', 2],
    ['bifrost-gate logs -v 10', 126], // flag disguised as a container name
    ['bifrost-gate logs we* 10', 2], // '*' stopped by the character filter
    ['bifrost-gate ps extra', 2],
    ['bifrost-gate ping\nreboot', 2],
  ];

  for (const [cmd, code] of denied) {
    it(`rejects ${JSON.stringify(cmd)} (exit ${code})`, () => {
      const r = run(cmd);
      assert.equal(r.code, code, r.err);
      assert.doesNotMatch(r.out, /DOCKER/);
    });
  }
});
