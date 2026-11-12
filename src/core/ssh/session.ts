import { Client } from 'ssh2';
import type { Config } from '../config/schema.ts';
import { BifrostError } from '../errors.ts';
import type { Logger } from '../logger.ts';
import { buildConnectConfig, type HostKeyCheck } from './connect-config.ts';
import { Semaphore } from './semaphore.ts';
import type { ExecOptions, ExecResult, Executor } from './types.ts';

/**
 * A single persistent SSH connection, opened lazily and reopened if it drops.
 * In MCP mode (long-lived process) it avoids a handshake per tool call; in the CLI it lives for one command.
 */
export class SshSession implements Executor {
  readonly #config: Config;
  readonly #logger: Logger;
  readonly #channels: Semaphore;
  #client: Client | undefined;
  #connecting: Promise<Client> | undefined;
  #ended = false;

  constructor(config: Config, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
    this.#channels = new Semaphore(config.limits.maxChannels);
  }

  async exec(command: string, opts: ExecOptions): Promise<ExecResult> {
    if (opts.signal?.aborted) throw new BifrostError('Operation cancelled.', 'CANCELLED');
    const release = await this.#channels.acquire();
    try {
      const client = await this.#getClient();
      return await runOnChannel(client, command, opts);
    } finally {
      release();
    }
  }

  end(): void {
    this.#ended = true;
    this.#client?.end();
    this.#client = undefined;
  }

  #getClient(): Promise<Client> {
    if (this.#ended) return Promise.reject(new BifrostError('SSH session already closed.', 'SSH'));
    if (this.#client) return Promise.resolve(this.#client);
    this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  async #connect(): Promise<Client> {
    const check: HostKeyCheck = {};
    const connectConfig = await buildConnectConfig(this.#config, check);
    const { host, port, username } = this.#config.server;
    this.#logger.debug(`connecting to ${username}@${host}:${port}`);

    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      let ready = false;

      client.on('ready', () => {
        ready = true;
        this.#client = client;
        this.#logger.debug('SSH connection ready');
        resolve(client);
      });

      // Permanent listener: an unhandled 'error' event would crash the whole MCP process.
      client.on('error', (err: Error & { level?: string }) => {
        if (ready) {
          this.#logger.warn(`SSH connection error: ${err.message}`);
          return;
        }
        if (check.mismatch) {
          reject(
            new BifrostError(
              `Host key MISMATCH for ${host}. Expected ${this.#config.server.fingerprint}, got ${check.mismatch}. ` +
                'Possible MITM or reinstalled server: verify out-of-band before updating the config.',
              'HOST_KEY',
            ),
          );
        } else if (err.level === 'client-authentication') {
          reject(
            new BifrostError(
              `Authentication rejected for ${username}@${host}. Is the key loaded in ssh-agent and present in authorized_keys?`,
              'SSH',
              { cause: err },
            ),
          );
        } else {
          reject(new BifrostError(`Failed to connect to ${host}:${port}: ${err.message}`, 'SSH', { cause: err }));
        }
      });

      client.on('close', () => {
        if (this.#client === client) {
          this.#client = undefined;
          if (!this.#ended) this.#logger.debug('SSH connection closed; it will be reopened on the next call');
        }
      });

      client.connect(connectConfig);
    });
  }
}

function runOnChannel(client: Client, command: string, opts: ExecOptions): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(new BifrostError(`Could not open SSH channel: ${err.message}`, 'SSH', { cause: err }));
        return;
      }

      const out: Buffer[] = [];
      const errOut: Buffer[] = [];
      let bytes = 0;
      let truncated = false;
      let timedOut = false;
      let aborted = false;

      const take = (sink: Buffer[]) => (chunk: Buffer) => {
        if (truncated) return;
        const room = opts.maxBytes - bytes;
        if (chunk.length > room) {
          sink.push(chunk.subarray(0, room));
          bytes = opts.maxBytes;
          truncated = true;
          stream.close();
        } else {
          sink.push(chunk);
          bytes += chunk.length;
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        stream.close();
      }, opts.timeoutMs);

      const onAbort = () => {
        aborted = true;
        stream.close();
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      stream.on('data', take(out));
      stream.stderr.on('data', take(errOut));

      stream.on('close', (code: number | null | undefined) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        if (timedOut) {
          reject(new BifrostError(`Remote command exceeded ${opts.timeoutMs}ms.`, 'TIMEOUT'));
        } else if (aborted) {
          reject(new BifrostError('Operation cancelled.', 'CANCELLED'));
        } else {
          resolve({
            code: code ?? null,
            stdout: Buffer.concat(out).toString('utf8'),
            stderr: Buffer.concat(errOut).toString('utf8'),
            truncated,
          });
        }
      });
    });
  });
}
