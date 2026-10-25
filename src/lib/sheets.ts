import type { AppData } from '../domain/model'

/** A complete, versioned shared snapshot. There is no automatic offline merge. */
export interface SheetSnapshot {
  data: AppData | null
  revision: number
  updatedAt: number
  mutationId?: string
}

export class SheetSyncError extends Error {
  readonly code: string
  readonly revision?: number

  constructor(message: string, code = 'NETWORK', revision?: number) {
    super(message)
    this.name = 'SheetSyncError'
    this.code = code
    this.revision = revision
  }
}

export function validateSheetEndpoint(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint.trim())
  } catch {
    throw new SheetSyncError('Enter a valid Apps Script web-app URL.', 'INVALID_URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'script.google.com' ||
    url.username ||
    url.password ||
    url.port ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new SheetSyncError(
      'Use the production https://script.google.com/macros/s/…/exec URL, without query parameters.',
      'INVALID_URL',
    )
  }
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`
}

function decodeSnapshot(value: unknown): SheetSnapshot {
  if (!value || typeof value !== 'object') {
    throw new SheetSyncError('The endpoint returned an invalid response.', 'INVALID_RESPONSE')
  }
  const response = value as Record<string, unknown>
  if (response.ok !== true) {
    throw new SheetSyncError(
      typeof response.error === 'string' ? response.error : 'The spreadsheet request failed.',
      typeof response.code === 'string' ? response.code : 'SERVER_ERROR',
      typeof response.revision === 'number' ? response.revision : undefined,
    )
  }
  if (
    !Number.isSafeInteger(response.revision) ||
    (response.revision as number) < 0 ||
    typeof response.updatedAt !== 'number' ||
    !Number.isFinite(response.updatedAt) ||
    response.updatedAt < 0 ||
    (response.mutationId !== undefined && typeof response.mutationId !== 'string')
  ) {
    throw new SheetSyncError('The endpoint returned invalid sync metadata.', 'INVALID_RESPONSE')
  }
  const data = response.data
  if (
    data !== null &&
    (!data ||
      typeof data !== 'object' ||
      (data as AppData).version !== 1 ||
      !Array.isArray((data as AppData).players) ||
      !Array.isArray((data as AppData).sessions) ||
      !Array.isArray((data as AppData).matches))
  ) {
    throw new SheetSyncError(
      'The shared data is missing or has an unsupported format.',
      'INVALID_RESPONSE',
    )
  }
  return {
    data: data as AppData | null,
    revision: response.revision as number,
    updatedAt: response.updatedAt,
    ...(typeof response.mutationId === 'string' ? { mutationId: response.mutationId } : {}),
  }
}

async function request(endpoint: string, body?: Record<string, unknown>): Promise<SheetSnapshot> {
  const base = validateSheetEndpoint(endpoint)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch(body ? base : `${base}?action=pull&t=${Date.now()}`, {
      method: body ? 'POST' : 'GET',
      // text/plain is CORS-safelisted. application/json would trigger an
      // OPTIONS preflight, which Apps Script web apps cannot implement.
      ...(body
        ? { headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) }
        : {}),
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new SheetSyncError(
        `Google returned HTTP ${response.status}. Check deployment access.`,
        'HTTP_ERROR',
      )
    }
    let result: unknown
    try {
      result = await response.json()
    } catch {
      throw new SheetSyncError(
        'Google returned a page instead of JSON. Check the /exec URL, deployment version, and access settings.',
        'INVALID_RESPONSE',
      )
    }
    return decodeSnapshot(result)
  } catch (error) {
    if (error instanceof SheetSyncError) throw error
    if (controller.signal.aborted) {
      throw new SheetSyncError(
        'Sync timed out. Your changes remain local. Check the shared revision before retrying.',
        'TIMEOUT',
      )
    }
    throw new SheetSyncError(
      'Cannot reach the spreadsheet. Check connectivity, deployment access, and browser cross-origin errors. Your data remains local.',
      'NETWORK',
    )
  } finally {
    clearTimeout(timeout)
  }
}

export function pullSheet(endpoint: string): Promise<SheetSnapshot> {
  return request(endpoint)
}

export function pushSheet(
  endpoint: string,
  data: AppData,
  expectedRevision: number,
  mutationId: string,
): Promise<SheetSnapshot> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return Promise.reject(
      new SheetSyncError('Pull the shared revision before uploading.', 'INVALID_REVISION'),
    )
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(mutationId)) {
    return Promise.reject(
      new SheetSyncError('A unique mutation ID is required.', 'INVALID_MUTATION'),
    )
  }
  return request(endpoint, { action: 'push', data, expectedRevision, mutationId })
}
