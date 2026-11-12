import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ConnectConfig } from 'ssh2';
import { expandHome } from '../config/load.ts';
import type { Config } from '../config/schema.ts';
import { BifrostError } from '../errors.ts';

/** Same format as `ssh-keygen -lf`: "SHA256:<unpadded base64>". */
export function fingerprintOf(hostKey: Buffer): string {
  return `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
}

function sameFingerprint(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface HostKeyCheck {
  /** Set by hostVerifier when the presented key does not match (used in the error message). */
  mismatch?: string;
}

export async function buildConnectConfig(config: Config, check: HostKeyCheck = {}): Promise<ConnectConfig> {
  const { server, auth } = config;

  const base: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: 10_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
    algorithms: { serverHostKey: [server.hostKeyAlgorithm] },
    // ssh2 does NOT verify host keys by default: without this, any MITM would be accepted.
    hostVerifier: (key: Buffer) => {
      const seen = fingerprintOf(key);
      const ok = sameFingerprint(seen, server.fingerprint);
      if (!ok) check.mismatch = seen;
      return ok;
    },
  };

  if (auth.method === 'password') {
    // No keyboard-interactive: a PAM prompt that is not the password would hang or leak it.
    return { ...base, password: auth.password, tryKeyboard: false };
  }

  if (auth.method === 'agent') {
    const sock = process.env.SSH_AUTH_SOCK;
    if (!sock) {
      throw new BifrostError(
        'auth.method is "agent" but SSH_AUTH_SOCK is not set. Run `ssh-add ~/.ssh/bifrost_ed25519` or use auth.method "key".',
        'CONFIG',
      );
    }
    return { ...base, agent: sock };
  }

  let privateKey: Buffer;
  try {
    privateKey = await readFile(expandHome(auth.privateKeyPath));
  } catch (cause) {
    throw new BifrostError(`Could not read the private key at ${auth.privateKeyPath}.`, 'CONFIG', { cause });
  }
  const passphrase = auth.passphraseEnv ? process.env[auth.passphraseEnv] : undefined;
  return { ...base, privateKey, ...(passphrase ? { passphrase } : {}) };
}
