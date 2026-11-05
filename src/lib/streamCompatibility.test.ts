import { afterEach, expect, test, vi } from 'vitest';
import { installReadableStreamAsyncIterator } from './streamCompatibility';

const prototype = ReadableStream.prototype;
const originalValues = Object.getOwnPropertyDescriptor(prototype, 'values');
const originalIterator = Object.getOwnPropertyDescriptor(prototype, Symbol.asyncIterator);
afterEach(() => {
  for (const [key, descriptor] of [['values', originalValues], [Symbol.asyncIterator, originalIterator]] as const) {
    if (descriptor) Object.defineProperty(prototype, key, descriptor);
    else Reflect.deleteProperty(prototype, key);
  }
});
function useFallback() {
  Reflect.deleteProperty(prototype, 'values');
  Reflect.deleteProperty(prototype, Symbol.asyncIterator);
  installReadableStreamAsyncIterator();
}
function numbers(cancel = vi.fn()) {
  return new ReadableStream<number>({ start(controller) { controller.enqueue(1); controller.enqueue(2); controller.close(); }, cancel });
}
type IterableStream<T> = ReadableStream<T> & {
  values(options?: { preventCancel?: boolean }): AsyncIterableIterator<T>;
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
};

test('drains a stream and releases its reader lock', async () => {
  useFallback();
  const stream = numbers() as IterableStream<number>, values = [];
  for await (const value of stream) values.push(value);
  expect(values).toEqual([1, 2]);
  expect(stream.locked).toBe(false);
});

test('cancels and unlocks when iteration ends early', async () => {
  useFallback();
  const cancel = vi.fn(), stream = numbers(cancel) as IterableStream<number>;
  for await (const value of stream) { expect(value).toBe(1); break; }
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

test('preserves unread data when preventCancel is requested', async () => {
  useFallback();
  const cancel = vi.fn(), stream = numbers(cancel) as IterableStream<number>;
  for await (const value of stream.values({ preventCancel: true })) { expect(value).toBe(1); break; }
  expect(cancel).not.toHaveBeenCalled();
  expect(stream.locked).toBe(false);
  const reader = stream.getReader();
  expect(await reader.read()).toEqual({ done: false, value: 2 });
  reader.releaseLock();
});

test('propagates read errors and releases the lock', async () => {
  useFallback();
  const failure = new Error('stream failed');
  const stream = new ReadableStream({ start(controller) { controller.error(failure); } }) as IterableStream<unknown>;
  await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(failure);
  expect(stream.locked).toBe(false);
});

test('keeps native iterator and values methods', () => {
  const iterator = (prototype as unknown as IterableStream<unknown>)[Symbol.asyncIterator];
  const values = (prototype as unknown as IterableStream<unknown>).values;
  installReadableStreamAsyncIterator();
  expect((prototype as unknown as IterableStream<unknown>)[Symbol.asyncIterator]).toBe(iterator);
  expect((prototype as unknown as IterableStream<unknown>).values).toBe(values);
});

test('reuses native values when only the iterator alias is missing', () => {
  Reflect.deleteProperty(prototype, Symbol.asyncIterator);
  const values = (prototype as unknown as IterableStream<unknown>).values;
  installReadableStreamAsyncIterator();
  expect((prototype as unknown as IterableStream<unknown>)[Symbol.asyncIterator]).toBe(values);
});
