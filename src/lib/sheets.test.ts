import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../domain/model'
import { pullSheet, pushSheet, SheetSyncError, validateSheetEndpoint } from './sheets'

const endpoint = 'https://script.google.com/macros/s/EXAMPLE_deployment-123/exec'
const snapshot = {
  ok: true,
  data: initialData(),
  revision: 1,
  updatedAt: 1234,
  mutationId: 'mutation-one',
}
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Sheets endpoint validation', () => {
  it('accepts production Apps Script endpoints and normalizes whitespace/trailing slash', () => {
    expect(validateSheetEndpoint(`  ${endpoint}/  `)).toBe(endpoint)
  })

  it.each([
    'not a url',
    'http://script.google.com/macros/s/abc/exec',
    'https://script.google.com.evil.test/macros/s/abc/exec',
    'https://script.googleusercontent.com/macros/s/abc/exec',
    'https://script.google.com/macros/s/abc/dev',
    `${endpoint}?secret=bad`,
    `${endpoint}#fragment`,
    'https://user:password@script.google.com/macros/s/abc/exec',
  ])('rejects unsafe or incorrect endpoint %s', (value) => {
    expect(() => validateSheetEndpoint(value)).toThrow(SheetSyncError)
  })
})

describe('Sheets transport', () => {
  it('pulls a cache-busted snapshot without credentials and follows Google redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(snapshot))
    vi.stubGlobal('fetch', fetchMock)
    await expect(pullSheet(endpoint)).resolves.toEqual({
      data: initialData(),
      revision: 1,
      updatedAt: 1234,
      mutationId: 'mutation-one',
    })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/exec\?action=pull&t=\d+$/)
    expect(options).toMatchObject({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
    })
    expect(options.headers).toBeUndefined()
  })

  it('accepts legacy and v2 snapshots while rejecting unsupported versions', async () => {
    for (const version of [1, 2]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ ...snapshot, data: { ...initialData(), version } })),
      )
      expect((await pullSheet(endpoint)).data?.version).toBe(version)
    }
  })

  it('accepts an empty shared store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ ok: true, data: null, revision: 0, updatedAt: 0 })),
    )
    await expect(pullSheet(endpoint)).resolves.toEqual({ data: null, revision: 0, updatedAt: 0 })
  })

  it('uses a CORS-safelisted text/plain POST with the exact revision and retry ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(snapshot))
    vi.stubGlobal('fetch', fetchMock)
    await pushSheet(endpoint, initialData(), 0, 'mutation-one')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(endpoint)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Content-Type': 'text/plain;charset=UTF-8' })
    expect(JSON.parse(options.body)).toEqual({
      action: 'push',
      data: initialData(),
      expectedRevision: 0,
      mutationId: 'mutation-one',
    })
  })

  it('retains server conflict code and remote revision', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ ok: false, code: 'CONFLICT', error: 'Shared history changed.', revision: 8 }),
        ),
    )
    await expect(pushSheet(endpoint, initialData(), 1, 'mutation-one')).rejects.toMatchObject({
      name: 'SheetSyncError',
      code: 'CONFLICT',
      revision: 8,
    })
  })

  it.each([
    {},
    { ...snapshot, revision: -1 },
    { ...snapshot, revision: 1.5 },
    { ...snapshot, updatedAt: 'yesterday' },
    { ...snapshot, data: undefined },
    { ...snapshot, data: { version: 3, players: [], sessions: [], matches: [] } },
    { ...snapshot, mutationId: 42 },
  ])('rejects invalid response metadata or unsupported snapshots', async (value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)))
    await expect(pullSheet(endpoint)).rejects.toBeInstanceOf(SheetSyncError)
  })

  it('reports a Google login/error HTML page instead of pretending it synced', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Sign in</html>')))
    await expect(pullSheet(endpoint)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('reports HTTP errors and browser network/CORS errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))
    await expect(pullSheet(endpoint)).rejects.toMatchObject({ code: 'HTTP_ERROR' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(pullSheet(endpoint)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('aborts a stalled request and reports that the commit may need checking', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )
    const assertion = expect(pullSheet(endpoint)).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(25_000)
    await assertion
  })

  it('rejects invalid revisions and mutation IDs before sending anything', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(pushSheet(endpoint, initialData(), -1, 'mutation-one')).rejects.toMatchObject({
      code: 'INVALID_REVISION',
    })
    await expect(pushSheet(endpoint, initialData(), 0, 'bad')).rejects.toMatchObject({
      code: 'INVALID_MUTATION',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
