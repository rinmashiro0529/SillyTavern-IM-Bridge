export class SessionTaskQueue {
  private readonly tails = new Map<string, Promise<void>>();

  public async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, tail);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}
