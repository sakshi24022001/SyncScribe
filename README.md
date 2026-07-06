# SyncScribe

A collaborative document editor that works fully offline, merges concurrent edits from multiple people deterministically (no data loss, no "last write wins"), and lets you travel back through version history without corrupting the live document for anyone else currently editing.

## What makes this different from a normal document editor

Most collaborative editors treat the server as the source of truth and the browser as a thin client. SyncScribe inverts that:

**The browser's local storage (IndexedDB) is the source of truth. The server is just where everyone's changes meet and merge.**

That one decision is what makes everything else possible:
- You can open, edit, and close a document with **zero network requests ever blocking the UI** — even fully offline.
- When you reconnect, your changes and everyone else's changes **merge automatically and safely** — nothing gets silently overwritten.
- Version history is **non-destructive** — restoring an old version never deletes anyone's newer work, even if they're actively editing at that exact moment.

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

## Core features

| Feature | How it works |
|---|---|
| **Local-first editing** | `src/hooks/useDocument.ts` loads from IndexedDB on mount before any network call; `src/lib/localdb.ts` is the durable client-side store |
| **Background sync engine** | `src/lib/syncEngine.ts` — debounced pushes, single-flight coalescing, exponential backoff with jitter, offline/online detection |
| **Deterministic conflict resolution** | Powered by Yjs CRDTs (`src/lib/crdt.ts`) — merges are order-independent by construction; proven in `tests/unit/merge.test.ts` |
| **No lost work on reconnect** | The server never overwrites, only appends (`doc_updates` table); incoming updates are merged as more CRDT ops, never a destructive replace |
| **Version history / time travel** | `doc_versions` table + `/api/documents/:id/versions`; restoring computes a CRDT diff-update rather than deleting rows |
| **Restore-safe for live collaborators** | A restore is just one more ordinary update flowing through the same sync path everyone already uses — nothing special, nothing destructive |
| **Hardened against malformed/oversized payloads** | `src/lib/validation.ts` — size ceilings checked before decoding, batch caps, structural schema validation, token-bucket rate limiting |
| **Role-based access (Owner / Editor / Viewer)** | Enforced in every mutating API route *and* at the database level via Postgres Row Level Security (`prisma/rls.sql`) |
| **Authentication** | Auth.js v5, JWT sessions, credentials provider (`src/lib/auth.ts`) |
| **Tenant isolation** | Postgres RLS keyed off a per-transaction session variable (`withTenantScope` in `src/lib/db.ts`) |
| **AI-powered add-ons** | `/api/ai/summarize` — streaming summarize / action-item extraction / clarity rewrite via the Vercel AI SDK |
| **Accessibility** | Live-region connection status, labelled form controls, semantic fieldsets throughout |
| **Testing** | Unit tests prove merge commutativity, idempotency, and payload validation; Playwright e2e tests prove real offline persistence and concurrent-offline reconciliation in an actual browser |
| **CI/CD** | `.github/workflows/ci.yml` — lint, migrate, apply RLS, run unit + e2e tests, build |

## The two hardest problems this project solves

**Preventing a malformed or massive payload from crashing the server.**
Every sync request passes through layered checks before any expensive work happens: a Content-Length pre-check (reject before buffering), structural schema validation (zod), per-item and per-batch byte ceilings checked on the *encoded* string length (so memory is never allocated just to discover a payload is too big), and per-user rate limiting. See `src/lib/validation.ts`.

**Avoiding state-sync race conditions.**
Choosing a CRDT (rather than a plain diff/overwrite model) means most classic "two writers, one winner" races simply don't exist — both people's edits survive by construction. What's left are engineering-level races around *when* to talk to the network, which `syncEngine.ts` handles explicitly: single-flight coalescing so concurrent sync triggers don't fire overlapping requests, debounced pushes so rapid typing doesn't spam the network, idempotent retries via client-generated operation IDs so a dropped response never double-applies an edit, and a pull-then-retry protocol when a client's view of the server is stale.

## Getting started

```bash
cp .env.example .env        # fill in DATABASE_URL, NEXTAUTH_SECRET, OPENAI_API_KEY
npm install
npx prisma migrate dev
npm run db:rls
npm run dev
```

## Testing

```bash
npm run test         # unit tests: CRDT determinism, validation guards
npm run test:e2e     # Playwright: offline persistence + concurrent reconciliation
```

## Tech stack

Next.js 16 · React 19 · TypeScript · Yjs (CRDT) · IndexedDB · PostgreSQL · Prisma · Auth.js v5 · Tailwind CSS · Radix UI · Vercel AI SDK · Vitest · Playwright

## Known simplifications

Being upfront about where this scaffold takes shortcuts, and what a production version would change:

- The editor binding is a hand-rolled diff over a `<textarea>` for clarity; a production system would use `y-prosemirror` for real rich-text formatting (bold, headings, lists) on top of the same underlying Yjs document.
- Rate limiting uses an in-memory token bucket; a multi-instance deployment would need this backed by Redis instead.
- Real-time presence/cursors (seeing who else is currently viewing) isn't implemented — this focuses on offline sync and version control specifically; live presence would layer a WebSocket awareness channel (`y-protocols/awareness`) on top of the existing sync engine.
- Automatic version capture on a timer/size threshold is designed for (`isAutoCapture` field exists on the schema) but the trigger itself isn't wired to a scheduled job in this scaffold — versions are currently captured manually.
