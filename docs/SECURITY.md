# Security

This document explains the threat model and the concrete controls implemented in this
codebase - it is written for a developer auditing the code, not as marketing copy.

## Trust boundary: the shop PC is the least-trusted device in the system

The shop's Windows computer has no physical security, may run other software, may be
shared with employees, and could be compromised by malware from an unrelated download.
Every design decision below follows from treating it as **hostile until proven
otherwise**, while still needing it to do real, useful work (print physical documents).

## What the desktop app can and cannot access

| Credential | Where it lives | Blast radius if the PC is fully compromised |
|---|---|---|
| Supabase anon key | `apps/desktop-ui` build config, `SmartPrinter.Agent` appsettings | Same as any public web client - grants nothing beyond what RLS explicitly allows for an anonymous/device caller. |
| Device secret (long-lived) | DPAPI-encrypted on disk (`CredentialStore`), `DataProtectionScope.LocalMachine` | Can be used to mint short-lived device access tokens for **this one shop's own rows only** (see RLS in `supabase/migrations/0002_rls_policies.sql`). Cannot read or write any other shop's data. |
| Device access token (short-lived, ~15 min) | In-memory only, attached to Postgrest/Realtime calls | Same scope as the device secret, but expires quickly even if somehow exfiltrated. |
| `service_role` key | **Never present anywhere in this repo's desktop code.** Only used server-side in Supabase Edge Functions (`supabase/functions/*`), which run in Supabase's infrastructure, not on the shop PC. | N/A - this is the whole point. |
| Razorpay keys/webhook secret | Only in Edge Function secrets (`supabase secrets set ...`), never in the desktop app or the renderer. | N/A |

**If you ever find yourself wanting to put a `service_role` key, a Razorpay secret key,
or the Supabase project's JWT signing secret into `SmartPrinter.Agent` or
`apps/desktop-ui`, stop - that is the specific mistake this architecture is built to
avoid.**

## DPAPI credential storage

`Security/DpapiCredentialProtector.cs` uses `DataProtectionScope.LocalMachine` with a
fixed application-specific entropy value. This is a legitimate, Microsoft-recommended
pattern for "a service needs a secret to survive reboots without a human re-entering a
password" - but be precise about what it defends against:

- **Defends against:** casual disk/file exfiltration of the credential blob (e.g.
  someone copies `%ProgramData%\SmartPrinter\Agent\device.credential` to a USB stick and
  tries to read it on another machine - `LocalMachine` scope means it won't decrypt
  there).
- **Does NOT defend against:** a full local Administrator/SYSTEM compromise on the SAME
  machine, which can call the same DPAPI unprotect operation as the service itself. No
  purely software-based secret storage on an untrusted machine can fully defend against
  this - hardware-backed storage (TPM-sealed keys) would be a further hardening step
  beyond this implementation's scope.

## Named Pipe IPC, not localhost HTTP

`Ipc/NamedPipeServer.cs` deliberately uses a Windows named pipe with an explicit
`PipeSecurity` ACL (BUILTIN\Users read/write, SYSTEM/Administrators full control)
instead of a `localhost` HTTP server. A named pipe:

- Is not reachable over the network, ever.
- Can be ACL'd to specific Windows principals - an unauthenticated `127.0.0.1:PORT`
  HTTP server is reachable by any other local process/user unless you build your own
  auth layer on top of it.

The command surface is a closed enum (`IpcCommands`), dispatched via a plain `switch` in
`IpcRouter.cs` - not reflection-based method invocation - so the full set of things the
UI can ask the agent to do is auditable in one file.

## Electron renderer sandboxing

`electron/main.ts` sets `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true` on the `BrowserWindow`. The renderer has **zero** direct access to
Node.js, `ipcRenderer`, or the filesystem - the only bridge is the narrow
`contextBridge.exposeInMainWorld` surface in `electron/preload.ts`
(`callAgent`, `openExternal`, `onUpdateDownloaded`). A Content-Security-Policy meta tag
in `index.html` further restricts script/style/connect sources.

`shell.openExternal` is never called with an arbitrary renderer-supplied URL - see
`tryOpenExternal` in `main.ts`, which checks against a small allowlist of hostnames.

## Customer file security

Uploaded documents are untrusted input from an anonymous customer. `JobProcessor.cs`
(`DownloadAsync`) enforces, in order:

1. Extension allowlist (`AgentOptions.AllowedFileExtensions`, default `.pdf` only).
2. Path traversal rejection on `storage_path` (`..`, rooted paths).
3. A hard byte-size cap (`AgentOptions.MaxDownloadFileSizeBytes`) enforced both from the
   HTTP `Content-Length` header AND while streaming (`SupabaseGateway.DownloadFromSignedUrlAsync`),
   so a server lying about content length can't cause unbounded memory/disk use.
4. A PDF magic-number check (`%PDF`) on the downloaded bytes before ever touching the
   printer.
5. Rendering via PDFium (`PdfiumPrintEngine`) rather than shelling out to the OS's
   default PDF handler - this avoids handing a potentially malicious file to whatever
   full-featured PDF reader happens to be installed on the shop PC, and never opens a
   visible window.
6. Each job's temp file lives in its own directory named after the job id and is deleted
   immediately after the job reaches a terminal state (`CleanupJobFiles`).

## Logging - what is and isn't captured

`Logging/SerilogConfig.cs` adds `SecretRedactionEnricher`, which regex-scrubs
`Bearer <token>` patterns and common secret-shaped key/value pairs
(`device_secret=...`, `access_token=...`, etc.) out of rendered log messages as a safety
net. The primary control is still discipline in the code itself - `CredentialStore` and
`DeviceAuthService` log device IDs and outcomes, never the secret or token values.

## Idempotency and duplicate-print prevention

- `SqliteQueueRepository.TryEnqueueJobAsync` enforces a `UNIQUE` constraint on
  `idempotency_key` - a redelivered Realtime event or a repeated catch-up query result
  can never create a second local job row.
- `JobProcessor` only calls `IPrinterService.SubmitDocumentAsync` once per job id, gated
  by the SQLite state machine (`queued -> claimed -> ... -> printing`) - a crash and
  restart replays from whatever state is recorded, never re-submits a job already past
  the `printing` state without first checking the spooler (`RecoverAsync`).

## Payment trust boundary

`supabase/functions/razorpay-webhook/index.ts` is the **only** place a payment is
considered successful. It verifies the Razorpay webhook HMAC-SHA256 signature using
`crypto.subtle` and a timing-safe comparison before touching the database. The browser's
Razorpay Checkout success callback is used only for UI optimism - see
`SubscriptionStatus.tsx`'s comment and `ARCHITECTURE.md §10`.

## Threat model summary

| Threat | Mitigation | Where |
|---|---|---|
| Compromised shop PC | Device-scoped credentials only, no service_role | Security/, Cloud/ |
| Stolen device credential | DPAPI encryption, short-lived access tokens, revocation | Security/, device-revoke function |
| Malicious customer upload | Extension/size/path/magic-number checks, sandboxed PDF rendering | JobProcessor.cs |
| Fake payment confirmation | Server-side webhook signature verification only | razorpay-webhook |
| Unauthorized printer access | Explicit owner authorization step, RLS by device_id | PrinterAuthorization.tsx, RLS policies |
| QR tampering | QR contains only a public slug, no secrets | QrCode.tsx |
| Replay attacks | Idempotency keys on jobs and payments | SqliteQueueRepository, payments unique constraint |
| Privilege escalation | Least-privilege RLS, no shared master key on desktop | RLS policies, SupabaseGateway |
| API abuse | Rate limiting - **not implemented in this repo**, see note below | - |

**Honest gap:** rate limiting on the public Edge Functions (`device-pairing-create`,
order creation, etc.) is not implemented in this codebase - Supabase's own platform-level
rate limits provide a baseline, but application-level limits (e.g. per-IP pairing-code
attempts) should be added before production rollout at scale. This is flagged rather
than silently omitted.
