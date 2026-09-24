// Runs before every test file (see `test.setupFiles` in vitest.config.ts).
// Registers jest-dom matchers and stubs browser APIs Radix reaches for that
// jsdom does not implement. Pure node suites have no `window` and skip this.
/* eslint-disable @typescript-eslint/no-empty-function -- intentional no-op stubs */
import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const w = window as unknown as Record<string, unknown>
  w.ResizeObserver ??= ResizeObserverStub
  w.matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  })
}
