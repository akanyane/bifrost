export type ErrorCode =
  | 'CONFIG'
  | 'SSH'
  | 'HOST_KEY'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'POLICY_DENIED'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'UNAVAILABLE'
  | 'GATE_DENIED'
  | 'REMOTE_FAILED';

/** An expected, handled error: its message is safe to show to both humans and agents. */
export class BifrostError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BifrostError';
    this.code = code;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof BifrostError) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return `[INTERNAL] ${err.message}`;
  return `[INTERNAL] ${String(err)}`;
}
