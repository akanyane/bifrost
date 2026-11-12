export interface ExecOptions {
  timeoutMs: number;
  /** Total byte budget (stdout + stderr). When exceeded, the channel is closed and the result marked as truncated. */
  maxBytes: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/** Transport abstraction; lets operations be tested without a real SSH server. */
export interface Executor {
  exec(command: string, opts: ExecOptions): Promise<ExecResult>;
  end(): void;
}
