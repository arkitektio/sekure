import { expect, it } from 'vitest'
import { unwrapHue } from './brand'

it('moves the hue the short way round the circle', () => {
  expect(unwrapHue(350, 10)).toBe(370)
  expect(unwrapHue(10, 350)).toBe(-10)
  expect(unwrapHue(370, 20)).toBe(380)
  expect(unwrapHue(100, 200)).toBe(200)
})
