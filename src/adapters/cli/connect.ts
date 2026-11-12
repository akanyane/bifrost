import { Command, InvalidArgumentError, Option } from 'commander';
import type { HostKeyAlgorithm } from '../../core/config/schema.ts';
import { BifrostError } from '../../core/errors.ts';
import { probe } from '../../core/ssh/probe.ts';
import { CredentialStore } from '../../core/store.ts';
import { ask, askHidden, canPrompt } from './prompt.ts';

const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

const err = (msg: string) => process.stderr.write(`${msg}\n`);

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new InvalidArgumentError('must be 1-65535.');
  return n;
}

function parseName(raw: string): string {
  if (!NAME_RE.test(raw)) throw new InvalidArgumentError('letters, digits, "_", "." and "-" only.');
  return raw;
}

function hostKeyFile(alg: HostKeyAlgorithm): string {
  if (alg === 'ssh-ed25519') return 'ed25519';
  return alg.startsWith('rsa') ? 'rsa' : 'ecdsa';
}

interface ConnectOpts {
  ip: string;
  user: string;
  password?: string;
  port: number;
  fingerprint?: string;
  name: string;
}

async function connect(opts: ConnectOpts): Promise<void> {
  if (opts.fingerprint && !FINGERPRINT_RE.test(opts.fingerprint)) {
    throw new BifrostError('--fingerprint must look like "SHA256:..." (from `ssh-keygen -lf`).', 'INVALID_INPUT');
  }

  let password = opts.password;
  if (password !== undefined) {
    err('warning: --password stays in your shell history and is visible in `ps`. Omit it to be prompted.');
  } else if (canPrompt()) {
    password = await askHidden(`Password for ${opts.user}@${opts.ip}: `);
  } else {
    throw new BifrostError('No terminal to prompt for the password: pass --password.', 'INVALID_INPUT');
  }
  if (!password) throw new BifrostError('Empty password.', 'INVALID_INPUT');

  const store = CredentialStore.open();
  try {
    // Reconnecting to the same server: the fingerprint we already trust must still match.
    const previous = store.get(opts.name);
    const known =
      opts.fingerprint ??
      (previous && previous.host === opts.ip && previous.port === opts.port ? previous.fingerprint : undefined);

    const result = await probe({
      host: opts.ip,
      port: opts.port,
      username: opts.user,
      password,
      ...(known ? { expectedFingerprint: known } : {}),
      ...(canPrompt()
        ? {
            confirmHostKey: async (fp, alg) => {
              err(`\nHost key for ${opts.ip}:${opts.port} (${alg}):\n  ${fp}\n`);
              err('Compare it with the output of this command ON THE SERVER (console, provider panel, etc.):');
              err(`  ssh-keygen -lf /etc/ssh/ssh_host_${hostKeyFile(alg)}_key.pub\n`);
              const answer = (await ask('Trust this host? [y/N] ')).trim().toLowerCase();
              return answer === 'y' || answer === 'yes' || answer === 's' || answer === 'sim';
            },
          }
        : {}),
    });

    store.save({
      name: opts.name,
      host: opts.ip,
      port: opts.port,
      username: opts.user,
      hostKeyAlgorithm: result.hostKeyAlgorithm,
      fingerprint: result.fingerprint,
      password,
    });
    store.setActive(opts.name);

    err(`ssh: ${opts.user}@${opts.ip}:${opts.port} (host key ${result.fingerprint}) ✓`);
    err(`saved as "${opts.name}" (active) in ${store.path}`);
    if (result.gateOk) {
      err('gate: pong ✓');
    } else {
      err(`warning: bifrost-gate did not answer "pong" (${result.gateDetail}).`);
      err('Commands will fail until the server is set up: see remote/install.md.');
    }
  } finally {
    store.close();
  }
}

export function registerConnectionCommands(program: Command): void {
  program
    .command('connect')
    .description('Save a server (IP, user, password) in the local store and make it the active one')
    .requiredOption('--ip <host>', 'server IP or hostname')
    .requiredOption('--user <name>', 'SSH user')
    .option('--password <password>', 'SSH password (omit to be prompted without echo)')
    .addOption(new Option('--port <n>', 'SSH port').default(22).argParser(parsePort))
    .option('--fingerprint <sha256>', 'expected host key ("SHA256:..."); skips the trust prompt')
    .addOption(new Option('--name <name>', 'name for this connection').default('default').argParser(parseName))
    .action(connect);

  program
    .command('disconnect')
    .description('Remove a saved connection (and its password) from the local store')
    .addOption(new Option('--name <name>', 'connection to remove').default('default').argParser(parseName))
    .action((opts: { name: string }) => {
      const store = CredentialStore.open();
      try {
        if (!store.remove(opts.name)) throw new BifrostError(`No connection named "${opts.name}".`, 'INVALID_INPUT');
        err(`removed "${opts.name}"`);
      } finally {
        store.close();
      }
    });

  program
    .command('connections')
    .description('List saved connections (passwords are never shown)')
    .action(() => {
      const store = CredentialStore.open();
      try {
        const active = store.activeName();
        const rows = store.list();
        if (rows.length === 0) err('No saved connections. Use `bifrost connect --ip <host> --user <user>`.');
        for (const c of rows) {
          process.stdout.write(`${c.name === active ? '*' : ' '} ${c.name}\t${c.username}@${c.host}:${c.port}\t${c.fingerprint}\n`);
        }
      } finally {
        store.close();
      }
    });

  program
    .command('use')
    .description('Make a saved connection the active one')
    .argument('<name>', 'connection name', parseName)
    .action((name: string) => {
      const store = CredentialStore.open();
      try {
        if (!store.get(name)) throw new BifrostError(`No connection named "${name}".`, 'INVALID_INPUT');
        store.setActive(name);
        err(`active: ${name}`);
      } finally {
        store.close();
      }
    });
}
