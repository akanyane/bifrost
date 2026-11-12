import { BifrostError } from './errors.ts';

/**
 * The client never sends shell. It sends a tiny token protocol to `bifrost-gate` on the server
 * (a forced command in authorized_keys), which is the real security boundary.
 *
 * Tokens are restricted to an alphabet without shell metacharacters, so there is nothing to
 * escape, and the gate enforces the same restriction on its side.
 */
export const GATE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const GATE_BINARY = 'bifrost-gate';

export function buildGateCommand(verb: string, args: ReadonlyArray<string | number> = []): string {
  const tokens = [verb, ...args.map(String)];
  for (const token of tokens) {
    if (!GATE_TOKEN_RE.test(token)) {
      throw new BifrostError(`Token rejected before sending: ${JSON.stringify(token)}`, 'INVALID_INPUT');
    }
  }
  return [GATE_BINARY, ...tokens].join(' ');
}
