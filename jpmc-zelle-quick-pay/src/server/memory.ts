import type { PaymentStore, StoreState } from "./contracts";
export function emptyState(): StoreState {
  return {
    sessions: {},
    preferences: {},
    recipients: {},
    events: {},
    allocations: {},
    outbox: {},
    exceptions: {},
    audit: {},
  };
}
/** Synthetic/demo storage only; serialized transactions also roll back on errors. */
export class MemoryStore implements PaymentStore {
  private state = emptyState();
  private tail: Promise<void> = Promise.resolve();
  async transaction<T>(fn: (state: StoreState) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const working = structuredClone(this.state);
    try {
      const result = await fn(working);
      this.state = working;
      return structuredClone(result);
    } finally {
      release();
    }
  }
}
