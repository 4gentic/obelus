// WKWebView (Tauri on macOS) ships `ReadableStream` without
// `Symbol.asyncIterator` / `values()` as of WebKit 21624. pdfjs 5's
// `getTextContent()` does `for await (const value of readableStream)` and
// crashes with "undefined is not a function (near '…value of readableStream…')"
// without this. Browsers that already implement it are no-ops.

type AsyncStreamProto = ReadableStream<unknown> & {
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
  values?: () => AsyncIterableIterator<unknown>;
};

if (typeof ReadableStream !== "undefined") {
  const proto = ReadableStream.prototype as unknown as AsyncStreamProto;
  if (typeof proto[Symbol.asyncIterator] !== "function") {
    const asyncIterator = function asyncIterator(
      this: ReadableStream<unknown>,
    ): AsyncIterableIterator<unknown> {
      const reader = this.getReader();
      const iterator: AsyncIterableIterator<unknown> = {
        next() {
          return reader.read() as Promise<IteratorResult<unknown>>;
        },
        return(value?: unknown) {
          reader.releaseLock();
          return Promise.resolve({ value, done: true } as IteratorResult<unknown>);
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    };
    Object.defineProperty(proto, Symbol.asyncIterator, {
      value: asyncIterator,
      writable: true,
      configurable: true,
    });
    if (typeof proto.values !== "function") {
      Object.defineProperty(proto, "values", {
        value: asyncIterator,
        writable: true,
        configurable: true,
      });
    }
  }
}
