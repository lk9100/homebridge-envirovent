/**
 * Serializes async operations with optional retry logic.
 *
 * The Envirovent unit handles one TCP connection at a time.
 * This queue ensures commands don't overlap, and retries transient failures.
 */

export interface CommandQueueOptions {
  /** Number of retry attempts on failure. Default: 1 (so 2 total attempts). */
  retries?: number;
  /** Delay between retries in ms. Default: 1000. */
  retryDelay?: number;
}

export class CommandQueue {
  private readonly retries: number;
  private readonly retryDelay: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: CommandQueueOptions = {}) {
    this.retries = options.retries ?? 1;
    this.retryDelay = options.retryDelay ?? 1000;
  }

  /**
   * Enqueue an async operation. It will wait for all previously enqueued
   * operations to complete before executing. Retries on failure.
   */
  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => this.withRetry(operation));
    // Update the queue chain — swallow errors so the queue doesn't stall
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt < this.retries) {
          await this.delay(this.retryDelay);
        }
      }
    }
    throw lastError;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
