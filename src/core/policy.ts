import { BifrostError } from './errors.ts';
import type { Config, Risk, Surface } from './config/schema.ts';

const RISK_RANK: Record<Risk, number> = { read: 0, write: 1, destructive: 2 };

export interface PolicySubject {
  name: string;
  risk: Risk;
  surfaces: readonly Surface[];
}

export function isAllowed(config: Config, surface: Surface, op: PolicySubject): boolean {
  return op.surfaces.includes(surface) && RISK_RANK[op.risk] <= RISK_RANK[config.policy[surface].maxRisk];
}

export function assertAllowed(config: Config, surface: Surface, op: PolicySubject): void {
  if (!op.surfaces.includes(surface)) {
    throw new BifrostError(`"${op.name}" is not available via ${surface}.`, 'POLICY_DENIED');
  }
  if (!isAllowed(config, surface, op)) {
    const max = config.policy[surface].maxRisk;
    throw new BifrostError(
      `"${op.name}" has risk "${op.risk}", above the maximum "${max}" configured for ${surface} (policy.${surface}.maxRisk).`,
      'POLICY_DENIED',
    );
  }
}

/** In-memory sliding window: stops an agent stuck in a loop from restarting things forever. */
export class RateLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #hits: number[] = [];

  constructor(max: number, windowSeconds: number, now: () => number = Date.now) {
    this.#max = max;
    this.#windowMs = windowSeconds * 1000;
    this.#now = now;
  }

  take(label: string): void {
    const now = this.#now();
    this.#hits = this.#hits.filter((t) => now - t < this.#windowMs);
    if (this.#hits.length >= this.#max) {
      const retryIn = Math.ceil((this.#windowMs - (now - this.#hits[0]!)) / 1000);
      throw new BifrostError(
        `Limit of ${this.#max} write operations per ${this.#windowMs / 1000}s reached (${label}). Retry in ${retryIn}s.`,
        'RATE_LIMITED',
      );
    }
    this.#hits.push(now);
  }
}
