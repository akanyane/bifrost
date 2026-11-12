import { Client } from 'ssh2';
import { HOST_KEY_ALGORITHMS, type HostKeyAlgorithm } from '../config/schema.ts';
import { BifrostError } from '../errors.ts';
import { buildGateCommand } from '../gate.ts';
import { fingerprintOf } from './connect-config.ts';
import { runOnChannel } from './session.ts';

export interface ProbeOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Known fingerprint: compared strictly, `confirmHostKey` is not called. */
  expectedFingerprint?: string;
  /** Trust on first use: show the fingerprint to the human and ask. */
  confirmHostKey?: (fingerprint: string, algorithm: HostKeyAlgorithm) => Promise<boolean>;
}

export interface ProbeResult {
  fingerprint: string;
  hostKeyAlgorithm: HostKeyAlgorithm;
  /** `bifrost-gate ping` answered "pong". */
  gateOk: boolean;
  gateDetail: string;
}

/** Key type is the first SSH string inside the public key blob. */
export function keyTypeOf(hostKey: Buffer): string {
  if (hostKey.length < 4) return '';
  const len = hostKey.readUInt32BE(0);
  return hostKey.subarray(4, 4 + len).toString('ascii');
}

/** RSA keys always say "ssh-rsa"; we only offer the SHA-2 signature algorithms, preferring sha2-512. */
export function algorithmFor(keyType: string): HostKeyAlgorithm | undefined {
  if (keyType === 'ssh-rsa') return 'rsa-sha2-512';
  return (HOST_KEY_ALGORITHMS as readonly string[]).includes(keyType) ? (keyType as HostKeyAlgorithm) : undefined;
}

/**
 * Used by `bifrost connect`: verifies (or asks to trust) the host key, authenticates with the
 * password and pings the gate. Nothing is saved here.
 */
export function probe(opts: ProbeOptions): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let seen: { fingerprint: string; algorithm: HostKeyAlgorithm } | undefined;
    let hostKeyError: BifrostError | undefined;

    const fail = (err: BifrostError) => {
      client.end();
      reject(err);
    };

    client.on('ready', async () => {
      try {
        const res = await runOnChannel(client, buildGateCommand('ping'), { timeoutMs: 15_000, maxBytes: 1024 });
        const gateOk = res.code === 0 && res.stdout.trim() === 'pong';
        const gateDetail = gateOk ? 'pong' : `exit ${res.code}: ${(res.stderr || res.stdout).trim().slice(0, 300)}`;
        client.end();
        resolve({ fingerprint: seen!.fingerprint, hostKeyAlgorithm: seen!.algorithm, gateOk, gateDetail });
      } catch (err) {
        fail(err instanceof BifrostError ? err : new BifrostError(String(err), 'SSH'));
      }
    });

    client.on('error', (err: Error & { level?: string }) => {
      if (hostKeyError) return reject(hostKeyError);
      if (err.level === 'client-authentication') {
        return reject(
          new BifrostError(
            `Authentication rejected for ${opts.username}@${opts.host}: wrong user/password, or PasswordAuthentication is off in sshd.`,
            'SSH',
            { cause: err },
          ),
        );
      }
      reject(new BifrostError(`Failed to connect to ${opts.host}:${opts.port}: ${err.message}`, 'SSH', { cause: err }));
    });

    client.connect({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      password: opts.password,
      tryKeyboard: false,
      // Long enough for a human to read and answer the host key prompt.
      readyTimeout: 120_000,
      algorithms: { serverHostKey: [...HOST_KEY_ALGORITHMS] },
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
        const fingerprint = fingerprintOf(key);
        const algorithm = algorithmFor(keyTypeOf(key));
        if (!algorithm) {
          hostKeyError = new BifrostError(`Unsupported host key type "${keyTypeOf(key)}".`, 'HOST_KEY');
          return verify(false);
        }
        seen = { fingerprint, algorithm };

        if (opts.expectedFingerprint) {
          if (fingerprint !== opts.expectedFingerprint) {
            hostKeyError = new BifrostError(
              `Host key MISMATCH for ${opts.host}. Expected ${opts.expectedFingerprint}, got ${fingerprint}.`,
              'HOST_KEY',
            );
          }
          return verify(!hostKeyError);
        }
        if (!opts.confirmHostKey) {
          hostKeyError = new BifrostError('Host key not confirmed: pass --fingerprint.', 'HOST_KEY');
          return verify(false);
        }
        opts.confirmHostKey(fingerprint, algorithm).then(
          (ok) => {
            if (!ok) hostKeyError = new BifrostError('Host key not trusted. Nothing was saved.', 'HOST_KEY');
            verify(ok);
          },
          () => {
            hostKeyError = new BifrostError('Host key prompt failed. Nothing was saved.', 'HOST_KEY');
            verify(false);
          },
        );
      },
    });
  });
}
