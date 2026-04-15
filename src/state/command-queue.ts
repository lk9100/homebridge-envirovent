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

export const createCommandQueue = (options: CommandQueueOptions = {}) => {
  const retries = options.retries ?? 1;
  const retryDelay = options.retryDelay ?? 1000;
  let queue: Promise<void> = Promise.resolve();

  const delay = async (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const withRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await delay(retryDelay);
        }
      }
    }
    throw lastError;
  };

  /**
   * Enqueue an async operation. It will wait for all previously enqueued
   * operations to complete before executing. Retries on failure.
   */
  const enqueue = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(async () => withRetry(operation));
    // Update the queue chain — swallow errors so the queue doesn't stall
    queue = result.then(() => {}, () => {});
    return result;
  };

  return { enqueue };
};

export type CommandQueue = ReturnType<typeof createCommandQueue>;
