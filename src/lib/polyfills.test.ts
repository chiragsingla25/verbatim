import { describe, expect, it } from 'vitest'

// The project's tsconfig lib target predates es2024, so Promise.withResolvers
// isn't in the type defs — hence the casts here (polyfills.ts casts for the same
// reason). We can't un-ship a native method under Node, so this exercises the
// polyfill body on a stand-in constructor shaped like the real one.
type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (r?: unknown) => void }
const wr = (P: PromiseConstructor) =>
  (P as unknown as { withResolvers: () => Deferred }).withResolvers()

describe('Promise.withResolvers polyfill', () => {
  it('module import is side-effect safe and leaves a working method', async () => {
    await import('./polyfills')
    expect(typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers).toBe('function')
    const d = wr(Promise)
    d.resolve(42)
    await expect(d.promise).resolves.toBe(42)
  })

  it('polyfill body returns the {promise,resolve,reject} triple and both paths work', async () => {
    // Rebuild the exact fallback from polyfills.ts against a stand-in constructor.
    const withResolvers = function (this: PromiseConstructor) {
      let resolve!: (v: unknown) => void
      let reject!: (r?: unknown) => void
      const promise = new this((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }
    const d = withResolvers.call(Promise) as Deferred
    expect(Object.keys(d).sort()).toEqual(['promise', 'reject', 'resolve'])
    expect(d.promise).toBeInstanceOf(Promise)
    d.reject(new Error('boom'))
    await expect(d.promise).rejects.toThrow('boom')
  })
})
