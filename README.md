# Local-First Collaborative Document Editor

A document editor that works fully offline, merges concurrent edits from
multiple collaborators deterministically (no data loss, no "last write
wins"), and lets users travel back through version history without
corrupting the live document for anyone else currently editing.

Built for the House of Edtech Fullstack Developer assignment.

## Why this architecture

The brief explicitly rules out CRUD-app thinking and asks for real
distributed-systems problem solving: race conditions, merge algorithms,
browser memory management. Here's the core decision that everything else
follows from:

**The client's local storage (IndexedDB) is the source of truth, not the
server.** The server is an append-only log of CRDT operations plus a
place to compute snapshots. This single decision is what makes "zero
network requests blocking the UI" and "no overwriting offline work"
possible at the same time — there's no server round trip standing between
a keystroke and it appearing on screen, and there's no "upload the whole
document" step that could clobber someone else's concurrent write.

## Architecture at a glance

```
┌─────────────────────────── Browser ───────────────────────────┐
│  Editor (textarea/contentEditable)                              │
│      │ keystrokes mutate directly                               │
│      ▼                                                           │
│  Y.Doc (CRDT, in-memory)  ──update event──▶  IndexedDB           │
│      │                                         (pendingOps       │
│      │                                          outbox +         │
│      │                                          merged doc state)│
│      ▼                                                           │
│  DocumentSyncEngine (debounced, single-flight, exp. backoff)     │
└──────────────────┬────────────────────────────────────────────┘
                    │  push (batched updates)   pull (since seq N)
                    ▼
┌─────────────────────────── Server ─────────────────────────────┐
│ Validate → RateLimit → AuthZ(role) → OptimisticConcurrency      │
│      │                                                           │
│      ▼                                                           │
│  doc_updates (append-only CRDT op log, Postgres, RLS-scoped)     │
│      │                                                           │
│      ▼                                                           │
│  doc_versions (on-demand full snapshots for time-travel)         │
└──────────────────────────────────────────────────────────────────┘
```

## How each requirement is satisfied

| Requirement | Implementation |
|---|---|
| Local-first, zero blocking UI | `src/hooks/useDocument.ts` loads from IndexedDB on mount before any network call; `src/lib/localdb.ts` is the durable store |
| Background sync engine | `src/lib/syncEngine.ts` — debounce, single-flight, exponential backoff+jitter, offline/online listeners |
| Deterministic conflict resolution | Yjs CRDT (`src/lib/crdt.ts`) — updates commute; proven in `tests/unit/merge.test.ts` |
| No overwrite of offline work on reconnect | Server never overwrites, only appends (`doc_updates` table); client applies incoming updates as more CRDT ops, not a replace |
| Version history / time travel | `doc_versions` table + `/api/documents/:id/versions`; restore computes a CRDT diff-update rather than deleting rows (`buildRestoreUpdate`) |
| Restore doesn't corrupt live collaborators | Restore is expressed as one more ordinary update through the same sync path everyone else already receives |
| Robust payload validation / anti-OOM | `src/lib/validation.ts` — size ceilings checked before decode, batch caps, structural zod schema, token-bucket rate limit |
| RBAC: Owner/Editor/Viewer | `DocumentMember.role`; enforced in every mutating route + Postgres RLS (`prisma/rls.sql`) |
| Viewers can't push | Explicit role check in `/api/sync/push`, backed by RLS `WITH CHECK` on `doc_updates` insert |
| Auth | Auth.js v5, JWT sessions, credentials provider (`src/lib/auth.ts`) |
| Tenant isolation | Postgres Row Level Security, `app.current_user_id` session var set per-transaction (`withTenantScope` in `src/lib/db.ts`) |
| AI add-on | `/api/ai/summarize` — streaming summarize/action-items/clarity rewrite via Vercel AI SDK |
| Accessibility | `aria-live` status region, labelled textarea, semantic fieldset/legend in share dialog |
| Testing | Unit tests prove merge commutativity + idempotency + validation guards; Playwright e2e proves offline persistence and concurrent-offline reconciliation |
| CI/CD | `.github/workflows/ci.yml` — lint, migrate, RLS apply, unit+e2e tests, build, deploy on merge to main |

## Handling the two hardest questions the brief asks

**"How do you prevent a malformed/massive payload from OOMing the
server?"** — Layered before any expensive work happens: Content-Length
pre-check → structural schema validation → per-item and per-batch byte
caps checked on the *encoded* string length (so we never allocate the
decoded buffer just to discover it's too big) → per-user token-bucket
rate limiting. See `src/lib/validation.ts` and the request-handling
order documented at the top of `src/app/api/sync/push/route.ts`.

**"How do you avoid state-sync race conditions?"** — By choosing a data
structure (CRDT) where merge order doesn't matter, most "race conditions"
in the traditional sense (two writers, one winner) simply don't exist —
both writers' content survives. What remains are engineering races around
*when* to talk to the network, handled explicitly in `syncEngine.ts`:
single-flight coalescing, debounced pushes, idempotent retries via
client-generated op IDs, and a 409-triggers-pull-then-retry protocol for
stale sequence numbers. Each is called out with an inline comment at the
point it's handled.

## Running locally

```bash
cp .env.example .env        # fill in DATABASE_URL, NEXTAUTH_SECRET, OPENAI_API_KEY
npm install
npx prisma migrate dev
npm run db:rls
npm run dev
```

## Testing

```bash
npm run test        # unit tests: CRDT determinism, validation guards
npm run test:e2e     # Playwright: offline persistence + concurrent reconciliation
```

## Known simplifications (be upfront about these in review/interview)

- The editor binding is a hand-rolled diff over a `<textarea>` for
  clarity; a production system would use `y-prosemirror` for real
  rich-text (bold/headings/lists) with the same underlying Yjs doc.
- Rate limiting uses an in-memory token bucket; swap for Redis to work
  correctly across multiple server instances.
- Real-time presence/cursors (who else is viewing) isn't implemented —
  the brief asks for offline sync + version control specifically, not
  live cursors; would add a WebSocket awareness channel (`y-protocols/awareness`) on top of this if scoped in.
- Auto-capture of versions on a timer/size threshold is designed for
  (`isAutoCapture` field) but the capture trigger itself isn't wired to a
  cron/queue in this scaffold.
