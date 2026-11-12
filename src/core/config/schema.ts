import * as z from 'zod';

/** Same pattern enforced by bifrost-gate on the server. */
export const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export const RiskSchema = z.enum(['read', 'write', 'destructive']);
export type Risk = z.infer<typeof RiskSchema>;

export type Surface = 'cli' | 'mcp';

export const HOST_KEY_ALGORITHMS = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256'] as const;
export type HostKeyAlgorithm = (typeof HOST_KEY_ALGORITHMS)[number];

export const ConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1).default('bifrost'),
    /** Pinned so the fingerprint we compare always belongs to the same host key. */
    hostKeyAlgorithm: z.enum(HOST_KEY_ALGORITHMS).default('ssh-ed25519'),
    fingerprint: z
      .string()
      .regex(/^SHA256:[A-Za-z0-9+/]{43}$/, 'use the "SHA256:..." format printed by `ssh-keygen -lf`'),
  }),

  auth: z
    .discriminatedUnion('method', [
      z.object({ method: z.literal('agent') }),
      z.object({
        method: z.literal('key'),
        privateKeyPath: z.string().min(1),
        /** Name of the environment variable holding the passphrase (never the passphrase itself). */
        passphraseEnv: z.string().optional(),
      }),
      /** Only injected from the local store (`bifrost connect`); loadConfig rejects it in the config file. */
      z.object({ method: z.literal('password'), password: z.string().min(1) }),
    ])
    .default({ method: 'agent' }),

  /** Containers Bifrost may touch. They must also be listed in /etc/bifrost/containers on the server. */
  containers: z.array(z.string().regex(CONTAINER_NAME_RE)).default([]),

  policy: z
    .object({
      cli: z.object({ maxRisk: RiskSchema.default('write') }).prefault({}),
      mcp: z
        .object({
          maxRisk: RiskSchema.default('read'),
          writesPerWindow: z.number().int().min(0).default(5),
          windowSeconds: z.number().int().min(1).default(600),
        })
        .prefault({}),
    })
    .prefault({}),

  limits: z
    .object({
      timeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
      maxOutputBytes: z.number().int().min(1024).max(1_048_576).default(65_536),
      maxChannels: z.number().int().min(1).max(10).default(4),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
