// Runtime shims for older browsers. Imported first in main.tsx, before anything else.
//
// pdfjs-dist v4 calls `Promise.withResolvers()` in both its main module and its
// worker. That method is only in Chrome/Edge ≥ 119, Firefox ≥ 121, Safari ≥ 17.4,
// so on an older browser the source-page render throws
// "Promise.withResolvers is not a function". Everything else the app uses is
// well within baseline, so this is the only shim we carry.
//
// The worker runs in its own realm and never sees this file — vite.config.ts
// prepends an equivalent polyfill to the worker bundle via `worker.rollupOptions
// .output.banner`. Keep the two in sync.
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
  ;(Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers<T>(
    this: PromiseConstructor,
  ) {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new this<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}
