import { describe, expect, it } from 'vitest'
import { escapeHtml, statusPage } from './loopback'

describe('statusPage', () => {
  it('escapes whatever ends up in the page', () => {
    const page = statusPage(
      false,
      'Could not connect',
      'Google returned: <img src=x onerror=alert(1)>'
    )
    expect(page).not.toContain('<img')
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;')
  })
})
