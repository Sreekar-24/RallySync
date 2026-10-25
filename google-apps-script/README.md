# Optional Google Sheets synchronization

RallySync works without Google. This optional bridge stores one group's shared
history in a dedicated spreadsheet. GitHub Pages serves the app; Google Apps
Script supplies the small read/write endpoint. IndexedDB remains the offline
copy. No API key, service-account JSON, paid server, or frontend Google OAuth
client is required for the deployment model below.

## Scope and access

Use **one organizer device as the writer**, with other devices viewing the shared
snapshot. Multiple writers are protected by revision checks, but their edits are
not automatically merged. Offline scoring stays local until successfully synced.

Google controls which deployment access options your account permits. The
cross-origin, account-free prototype requires a deployment that executes as its
owner and accepts anonymous callers (usually **Who has access: Anyone**).
**Anyone who obtains that endpoint can read and replace the group history.**
The spreadsheet itself can stay private, but that does not make this endpoint
private. Treat this as a trusted-group prototype, avoid sensitive personal data,
and revoke the deployment if the link leaks. The URL is not authentication. A
frontend PIN or embedded token would not fix this. Use an authenticated backend
before exposing confidential records or accepting untrusted users.

If anonymous deployment is unavailable under your organization's Google policy,
this exact browser-only integration will not work. Keep using local mode, or
implement an authenticated Google API flow; do not make the spreadsheet publicly
editable to work around it.

## Upgrade an existing deployment

This release writes **snapshot version 2**, adding whole-session schedules, availability windows, player-attributed points, and direct score adjustments. Existing version-1 backups and stored snapshots migrate without changing results or inventing individual contributions.

Replace the Apps Script source with this version and publish a **new deployment version** before enabling Sheets synchronization in the updated app. Running `setup()` again preserves the spreadsheet. Update every organizer/viewer to the new web app before editing; old clients deliberately reject v2 snapshots rather than silently losing new fields. An old deployed script rejects v2 uploads, so local scores remain safe but synchronization reports an error until the script is upgraded.

The storage manifest and HTTP protocol are unchanged. Do not clear the storage tabs to upgrade.

## Create and deploy

1. Create a **dedicated** Google Sheet in the account that will maintain it.
2. Open **Extensions → Apps Script**. Replace the starter code with
   [Code.gs](Code.gs). Save the project. The default V8 runtime is required.
3. Select `setup` and run it. Review and grant the spreadsheet permissions in
   Google's authorization screen. It creates `_RallyState` and `_RallyChunks` and
   stores the spreadsheet ID in Script Properties. Running it again preserves
   existing data. No IDs need to be inserted into the source code.
4. Choose **Deploy → New deployment → Web app**. Choose **Execute as: Me** and
   the access setting appropriate to the prototype above. Deployment is an
   account-owner action; the application cannot approve Google's consent screen.
5. Copy the production URL shaped like
   `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`. Do not use `/dev`, an
   editor URL, a spreadsheet URL, or a redirect URL on `googleusercontent.com`.
6. In RallySync's settings, enter that endpoint and connect. First pull and inspect
   the shared state. Publish local history only if you intend it to become the
   shared history. An empty remote starts at revision `0`.
7. Test from the **actual GitHub Pages origin**: publish a small session, pull it
   in a second browser, and confirm the names and score. Then verify an offline
   edit reconnects without duplicate points. Deployment is not validated merely
   because the URL opens in a browser tab.

When changing script code, use **Deploy → Manage deployments → Edit → New
version → Deploy** to update the existing deployment. Saving the editor alone
does not update the production `/exec` version. Reusing the deployment preserves
its URL. Keep the Apps Script project and spreadsheet owned by an account that
will remain available to the group.

## Browser transport and troubleshooting

The client sends simple `text/plain;charset=UTF-8` POST requests containing JSON.
That avoids the `OPTIONS` preflight that an `application/json` POST would trigger;
Apps Script web apps do not expose an `OPTIONS` handler. Reads use a cache-busted
GET. `ContentService` serves JSON through Google's redirect to
`script.googleusercontent.com`, so the client follows redirects and omits cookies.

The final response must be readable under the browser's CORS policy. Public web
app deployments can support this route, but access policy, authorization pages,
and Google redirects must be tested in the deployed environment. Never switch to
`mode: 'no-cors'`: its opaque response cannot confirm whether a score was stored.

| Symptom                                   | Check                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON says `NOT_CONFIGURED`                | Run `setup()` in the script bound to the intended spreadsheet.                                                                                                                            |
| Google sign-in HTML, 403, or a CORS error | Check production `/exec`, anonymous-access eligibility, execute-as-owner setting, and the **final** response in browser developer tools. Do not solve this by disabling browser security. |
| Editor changes appear to do nothing       | Deploy a new version of the existing web app.                                                                                                                                             |
| `CONFLICT`                                | Another accepted update changed the revision. Export a local backup, pull, inspect, and explicitly choose which history to keep.                                                          |
| `BUSY`                                    | Another request holds the script lock. Back off, pull, and retry safely.                                                                                                                  |
| `STORAGE_ERROR` or timeout                | Preserve local history. Pull first: the update might already have committed even if its acknowledgement was lost.                                                                         |
| `INVALID_DATA`                            | The snapshot fails schema/reference validation; do not upload a hand-edited partial backup.                                                                                               |
| `TOO_LARGE` or quota errors               | Export/archive history, reduce polling/write frequency, or move to a database.                                                                                                            |

If your environment restricts outbound network destinations, allow
`script.google.com` and `script.googleusercontent.com` for this integration.
Owner authorization can additionally involve Google's account pages.

## Protocol

`GET /exec?action=pull&t=<cache-buster>` returns:

```json
{ "ok": true, "data": null, "revision": 0, "updatedAt": 0 }
```

After a successful write, `data` contains the complete version-2 `AppData`, and
`mutationId` identifies the last committed update.

`POST /exec` accepts JSON as **text/plain**, not an HTML form:

```json
{
  "action": "push",
  "expectedRevision": 0,
  "mutationId": "a-unique-uuid-for-this-logical-update",
  "data": { "version": 1, "players": [], "sessions": [], "matches": [] }
}
```

`initialize` is an optional write action with the same body; it only accepts an
empty shared store. Normal clients can use `push` for the first write.

Success returns `ok`, the committed `data`, new `revision`, `updatedAt`, and
`mutationId`. Failure returns `ok:false`, `code`, and `error`, with the current
revision on conflicts. Apps Script's `ContentService` cannot set arbitrary HTTP
status codes, so clients must inspect `ok` even for an HTTP 200 response.

Client exports in `src/lib/sheets.ts`:

```ts
pullSheet(endpoint): Promise<SheetSnapshot>
pushSheet(endpoint, data, expectedRevision, mutationId): Promise<SheetSnapshot>
```

For a retry of the **same** logical upload, reuse its mutation ID and exact data.
The most recent committed mutation is idempotent. Older repeated mutations are
rejected as stale by the expected revision. Pulling after a lost acknowledgement
reveals whether the pending mutation was accepted; never blindly rebase and upload
an old local snapshot onto a newer remote revision.

## Storage and recovery

The machine-managed tabs contain chunked, base64-encoded JSON snapshots:

- `_RallyState`: one authoritative manifest row with revision, payload ID, chunk
  count, commit time, last mutation ID, and SHA-256 checksum.
- `_RallyChunks`: payload chunks safely below Sheets' per-cell character limit.

The script validates data, holds a script lock, writes and verifies a new payload,
then updates the manifest in one range operation. A failure before the manifest
commit leaves the previous snapshot readable. It keeps the current and previous
payloads and removes older/orphaned chunks after a successful commit. This is a
defensive snapshot protocol, **not** a claim that Sheets provides database
transactions. Do not edit, rename, sort, or insert rows in these storage tabs.

These tabs are not human-readable reporting tables. Use RallySync's CSV exports
in separate spreadsheet tabs for analysis. This avoids someone editing a report
and unintentionally corrupting the application's canonical data.

Keep periodic JSON backups outside the shared spreadsheet. Deleting the sheet,
revoking its owner's access, or losing the Google account is not repaired by this
bridge. Do not commit player history or deployed endpoint configuration into the
public application repository.

## Capacity and verification

This is designed for a friends' group, not a high-traffic public service. Each
upload transfers a full snapshot, and each read runs Apps Script. Batch scoring
updates, use adaptive polling/backoff, and suspend polling in hidden tabs. Google
quotas vary by account and may change. Large histories and low-latency live
scoring across many devices warrant a database/realtime service.

The bridge caps serialized history at 2,000,000 JavaScript characters and validates
reference integrity. Those implementation limits are not a Google service SLA.
Local protocol tests do not prove Google authorization, deployment permissions,
network access, quotas, or browser cross-origin behavior. A live integration is
verified only after the read/write/reconnect checks above pass against your
deployment.

Official references:

- [Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [Content Service and redirects](https://developers.google.com/apps-script/guides/content)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Lock Service](https://developers.google.com/apps-script/reference/lock/lock-service)
