// Some WKWebView versions expose ReadableStream without async iteration, which
// PDF.js uses when extracting text. Keep native implementations when available.
async function* streamValues<T>(this: ReadableStream<T>, { preventCancel = false } = {}) {
  const reader = this.getReader();
  let completed = false;
  try {
    while (true) {
      let result: ReadableStreamReadResult<T>;
      try { result = await reader.read(); }
      catch (error) { completed = true; throw error; }
      if (result.done) { completed = true; return; }
      yield result.value;
    }
  } finally {
    try { if (!completed && !preventCancel) await reader.cancel(); }
    finally { reader.releaseLock(); }
  }
}

export function installReadableStreamAsyncIterator() {
  const Stream = globalThis.ReadableStream;
  if (!Stream) return;
  const prototype = Stream.prototype as ReadableStream<unknown> & {
    values?: typeof streamValues;
    [Symbol.asyncIterator]?: typeof streamValues;
  };
  if (typeof prototype[Symbol.asyncIterator] === 'function') return;
  if (typeof prototype.values !== 'function') {
    Object.defineProperty(prototype, 'values', { value: streamValues, writable: true, configurable: true });
  }
  Object.defineProperty(prototype, Symbol.asyncIterator, { value: prototype.values, writable: true, configurable: true });
}

installReadableStreamAsyncIterator();
