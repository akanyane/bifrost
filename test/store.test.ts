import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadConfig } from '../src/core/config/load.ts';
import { buildConnectConfig } from '../src/core/ssh/connect-config.ts';
import { algorithmFor, keyTypeOf } from '../src/core/ssh/probe.ts';
import { CredentialStore, type Connection } from '../src/core/store.ts';

const dir = mkdtempSync(join(tmpdir(), 'bifrost-store-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const conn = (over: Partial<Connection> = {}): Connection => ({
  name: 'default',
  host: '203.0.113.10',
  port: 22,
  username: 'bifrost',
  hostKeyAlgorithm: 'ssh-ed25519',
  fingerprint: `SHA256:${'B'.repeat(43)}`,
  password: 's3cret',
  ...over,
});

describe('CredentialStore', () => {
  it('saves, updates, lists and removes; tracks the active connection', () => {
    const store = CredentialStore.open(':memory:');
    store.save(conn());
    store.save(conn({ name: 'staging', host: '198.51.100.7' }));
    store.save(conn({ password: 'changed' }));
    store.setActive('staging');

    assert.equal(store.get('default')?.password, 'changed');
    assert.deepEqual(store.list().map((c) => c.name), ['default', 'staging']);
    assert.equal(store.active()?.host, '198.51.100.7');

    assert.equal(store.remove('staging'), true);
    assert.equal(store.active(), undefined, 'removing the active connection clears it');
    assert.equal(store.remove('nope'), false);
    store.close();
  });

  it('creates the database file with mode 0600 and its directory with 0700', () => {
    const path = join(dir, 'perm', 'bifrost.db');
    CredentialStore.open(path).close();
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'perm')).mode & 0o777, 0o700);
  });
});

describe('loadConfig with the store', () => {
  const missingConfig = join(dir, 'missing.json');

  it('works without a config file when there is an active connection', async () => {
    const db = join(dir, 'a.db');
    const store = CredentialStore.open(db);
    store.save(conn());
    store.setActive('default');
    store.close();

    const config = await loadConfig(missingConfig, db);
    assert.equal(config.server.host, '203.0.113.10');
    assert.deepEqual(config.auth, { method: 'password', password: 's3cret' });
    assert.equal(config.policy.mcp.maxRisk, 'read', 'defaults still apply');

    const ssh = await buildConnectConfig(config);
    assert.equal(ssh.password, 's3cret');
    assert.equal(ssh.tryKeyboard, false);
  });

  it('the active connection overrides server/auth but keeps the rest of the config file', async () => {
    const db = join(dir, 'b.db');
    const store = CredentialStore.open(db);
    store.save(conn({ host: '192.0.2.1' }));
    store.setActive('default');
    store.close();

    const file = join(dir, 'b.json');
    writeFileSync(file, JSON.stringify({ server: { host: 'old', fingerprint: `SHA256:${'C'.repeat(43)}` }, containers: ['web'] }));
    const config = await loadConfig(file, db);
    assert.equal(config.server.host, '192.0.2.1');
    assert.deepEqual(config.containers, ['web']);
  });

  it('fails with a hint when there is neither a connection nor a config file', async () => {
    await assert.rejects(loadConfig(missingConfig, join(dir, 'none.db')), /bifrost connect/);
  });

  it('does not create the database just by loading the config', async () => {
    const db = join(dir, 'never.db');
    await assert.rejects(loadConfig(missingConfig, db));
    assert.throws(() => statSync(db));
  });

  it('rejects a password written in the config file', async () => {
    const file = join(dir, 'pw.json');
    writeFileSync(
      file,
      JSON.stringify({ server: { host: 'h', fingerprint: `SHA256:${'C'.repeat(43)}` }, auth: { method: 'password', password: 'x' } }),
    );
    await assert.rejects(loadConfig(file, join(dir, 'none.db')), /not allowed in the config file/);
  });
});

describe('host key type', () => {
  const blob = (type: string) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(type.length);
    return Buffer.concat([len, Buffer.from(type), Buffer.from([1, 2, 3])]);
  };

  it('reads the key type and maps it to the pinned algorithm', () => {
    assert.equal(keyTypeOf(blob('ssh-ed25519')), 'ssh-ed25519');
    assert.equal(algorithmFor('ssh-ed25519'), 'ssh-ed25519');
    assert.equal(algorithmFor('ecdsa-sha2-nistp256'), 'ecdsa-sha2-nistp256');
    assert.equal(algorithmFor('ssh-rsa'), 'rsa-sha2-512');
    assert.equal(algorithmFor('ssh-dss'), undefined);
    assert.equal(keyTypeOf(Buffer.alloc(2)), '');
  });
});
