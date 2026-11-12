/** Caps concurrent `exec` channels (sshd rejects anything above MaxSessions, 10 by default). */
export class Semaphore {
  #available: number;
  readonly #waiters: Array<() => void> = [];

  constructor(size: number) {
    this.#available = size;
  }

  async acquire(): Promise<() => void> {
    if (this.#available > 0) {
      this.#available--;
    } else {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiters.shift();
      if (next) next();
      else this.#available++;
    };
  }
}
