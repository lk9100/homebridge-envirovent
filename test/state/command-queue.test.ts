import { describe, it, expect } from 'vitest';
import { createCommandQueue } from '../../src/state/command-queue.js';

describe('CommandQueue', () => {
  it('executes a single operation', async () => {
    const queue = createCommandQueue();
    const result = await queue.enqueue(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('serializes operations in order', async () => {
    const queue = createCommandQueue();
    const order: number[] = [];

    const p1 = queue.enqueue(async () => {
      await delay(50);
      order.push(1);
      return 1;
    });
    const p2 = queue.enqueue(async () => {
      order.push(2);
      return 2;
    });
    const p3 = queue.enqueue(async () => {
      order.push(3);
      return 3;
    });

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('retries failed operations', async () => {
    const queue = createCommandQueue({ retries: 2, retryDelay: 10 });
    let attempts = 0;

    const result = await queue.enqueue(async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'success';
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    const queue = createCommandQueue({ retries: 1, retryDelay: 10 });

    await expect(
      queue.enqueue(() => Promise.reject(new Error('permanent'))),
    ).rejects.toThrow('permanent');
  });

  it('continues processing after a failed operation', async () => {
    const queue = createCommandQueue({ retries: 0 });

    // First operation fails
    await expect(
      queue.enqueue(() => Promise.reject(new Error('fail'))),
    ).rejects.toThrow();

    // Second operation should still work
    const result = await queue.enqueue(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('does not retry when retries is 0', async () => {
    const queue = createCommandQueue({ retries: 0 });
    let attempts = 0;

    await expect(
      queue.enqueue(async () => {
        attempts++;
        throw new Error('fail');
      }),
    ).rejects.toThrow();

    expect(attempts).toBe(1);
  });
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
