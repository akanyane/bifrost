import { ConfigSchema, type Config } from '../src/core/config/schema.ts';
import { noopAudit, type AuditEntry, type AuditLog } from '../src/core/audit.ts';
import { silentLogger } from '../src/core/logger.ts';
import { createRuntime, type Runtime } from '../src/core/runtime.ts';
import type { ExecOptions, ExecResult, Executor } from '../src/core/ssh/types.ts';

export function testConfig(overrides: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse({
    server: { host: 'example.test', fingerprint: `SHA256:${'A'.repeat(43)}` },
    containers: ['web', 'api'],
    ...overrides,
  });
}

export class FakeExecutor implements Executor {
  readonly calls: Array<{ command: string; opts: ExecOptions }> = [];
  next: Partial<ExecResult> = {};

  async exec(command: string, opts: ExecOptions): Promise<ExecResult> {
    this.calls.push({ command, opts });
    return { code: 0, stdout: '', stderr: '', truncated: false, ...this.next };
  }

  end(): void {}
}

export function testRuntime(config = testConfig()): { rt: Runtime; executor: FakeExecutor; audits: AuditEntry[] } {
  const executor = new FakeExecutor();
  const audits: AuditEntry[] = [];
  const audit: AuditLog = {
    async record(e) {
      audits.push(e);
      await noopAudit.record(e);
    },
  };
  return { rt: createRuntime(config, { executor, logger: silentLogger, audit }), executor, audits };
}
