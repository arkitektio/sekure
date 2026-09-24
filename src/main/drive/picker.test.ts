import { describe, expect, it } from 'vitest'
import { parsePicked, pickDriveFile, pickerPage } from './picker'

const cfg = { accessToken: 'ya29.token', apiKey: 'AIzaKey', appId: '1234' }

describe('pickerPage', () => {
  it('inlines the config without letting it close the script', () => {
    const page = pickerPage({ ...cfg, apiKey: '</script><script>alert(1)</script>' }, 'st')
    expect(page).not.toContain('</script><script>alert(1)')
    expect(page).toContain('\\u003c/script>')
  })
})

describe('parsePicked', () => {
  it('accepts a Drive id, a cancel, and nothing else', () => {
    expect(parsePicked('{"id":"1AbCdEfGhIjKlMn","name":"v.kdbx"}')).toEqual({
      id: '1AbCdEfGhIjKlMn',
      name: 'v.kdbx'
    })
    expect(parsePicked('{"cancelled":true}')).toBeNull()
    for (const body of ['nope', '{}', '{"id":"../../x"}', '{"id":"short"}', 'null']) {
      expect(parsePicked(body), body).toBeUndefined()
    }
  })
})

describe('pickDriveFile', () => {
  it('serves the page once, then resolves with the file the page posts back', async () => {
    let pageUrl = ''
    const picked = pickDriveFile(cfg, (url) => {
      pageUrl = url
    })
    await expect.poll(() => pageUrl).not.toBe('')
    const origin = new URL(pageUrl).origin

    const page = await fetch(pageUrl)
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toBe('no-store')
    const html = await page.text()
    expect(html).toContain('ya29.token')
    // The token-bearing page is served exactly once.
    expect((await fetch(pageUrl)).status).toBe(404)

    const state = /"state":"([^"]+)"/.exec(html)![1]
    // Wrong state and bad bodies are refused without ending the flow.
    const bad = await fetch(`${origin}/picked?state=nope`, { method: 'POST', body: '{}' })
    expect(bad.status).toBe(404)
    const invalid = await fetch(`${origin}/picked?state=${state}`, {
      method: 'POST',
      body: '{"id":"x"}'
    })
    expect(invalid.status).toBe(400)

    const ok = await fetch(`${origin}/picked?state=${state}`, {
      method: 'POST',
      body: JSON.stringify({ id: '1AbCdEfGhIjKlMn', name: 'vault.kdbx' })
    })
    expect(ok.status).toBe(204)
    await expect(picked).resolves.toEqual({ id: '1AbCdEfGhIjKlMn', name: 'vault.kdbx' })
  })

  it('can be cancelled', async () => {
    const controller = new AbortController()
    const picked = pickDriveFile(cfg, () => controller.abort(), { signal: controller.signal })
    await expect(picked).rejects.toThrow(/cancelled/)
  })
})
