import { describe, expect, it } from 'vitest'
import { externalUrl, hasOrigin } from './urls'

describe('externalUrl', () => {
  it('allows http(s) and adds https to bare hosts', () => {
    expect(externalUrl('https://example.com/login')).toBe('https://example.com/login')
    expect(externalUrl('http://intranet.local:8080/')).toBe('http://intranet.local:8080/')
    expect(externalUrl(' example.com/login ')).toBe('https://example.com/login')
  })

  it('refuses every other scheme and embedded credentials', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'smb://server/share',
      'x-apple.systempreferences:',
      'ms-msdt:/id',
      'data:text/html,hi',
      'https://user:pass@example.com',
      '',
      'https://'
    ]) {
      expect(externalUrl(url), url).toBeUndefined()
    }
  })
})

describe('hasOrigin', () => {
  it('matches scheme and host exactly, custom schemes included', () => {
    expect(hasOrigin('app://bundle/index.html#/vault', 'app://bundle')).toBe(true)
    expect(hasOrigin('app://bundle.evil/index.html', 'app://bundle')).toBe(false)
    expect(hasOrigin('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(hasOrigin('http://localhost:5173.evil.com/', 'http://localhost:5173')).toBe(false)
    expect(hasOrigin('https://bundle/', 'app://bundle')).toBe(false)
    expect(hasOrigin('not a url', 'app://bundle')).toBe(false)
  })
})
