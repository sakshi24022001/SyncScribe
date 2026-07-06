-- ============================================================================
-- ROW LEVEL SECURITY — run after `prisma migrate deploy`
--
-- NOTE ON COLUMN NAMING: Prisma's default column naming follows the field
-- names exactly as written in schema.prisma (camelCase: ownerId,
-- documentId, userId), even though table names were mapped to snake_case
-- via @@map(). Only the TABLE names are snake_case here — column names are
-- camelCase and must be double-quoted in raw SQL, since Postgres folds
-- unquoted identifiers to lowercase (unquoted ownerId would be read as
-- "downerid" otherwise, hence the earlier "column does not exist" error).
--
-- Why this exists on top of Prisma query filters:
-- Application-layer "WHERE userId = ?" checks are only as safe as every
-- query in the codebase remembering to add them. RLS moves the boundary
-- into Postgres itself: even a raw SQL query or a compromised app-layer
-- bug cannot read rows outside what the current session is allowed to
-- see, because Postgres enforces it on every scan.
--
-- We use `app.current_user_id` (a per-connection session variable, set via
-- `SET LOCAL` at the start of every request, see lib/db.ts) rather than a
-- Postgres role-per-tenant model, since our tenants are individual users
-- with many-to-many document membership, not fully isolated schemas.
-- ============================================================================

ALTER TABLE documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_updates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_versions      ENABLE ROW LEVEL SECURITY;

-- Documents: visible if you are the owner OR a member (any role)
DROP POLICY IF EXISTS documents_isolation ON documents;
CREATE POLICY documents_isolation ON documents
  USING (
    "ownerId" = current_setting('app.current_user_id', true)
    OR EXISTS (
      SELECT 1 FROM document_members dm
      WHERE dm."documentId" = documents.id
        AND dm."userId" = current_setting('app.current_user_id', true)
    )
  );

-- Membership rows: you can see membership rows for docs you belong to
DROP POLICY IF EXISTS document_members_isolation ON document_members;
CREATE POLICY document_members_isolation ON document_members
  USING (
    "userId" = current_setting('app.current_user_id', true)
    OR EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_members."documentId"
        AND d."ownerId" = current_setting('app.current_user_id', true)
    )
  );

-- Update log: only members of the document can read/write updates.
-- Write path additionally checks role != VIEWER in application code AND
-- here, redundantly, via a WITH CHECK clause on INSERT.
DROP POLICY IF EXISTS doc_updates_select ON doc_updates;
CREATE POLICY doc_updates_select ON doc_updates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM document_members dm
      WHERE dm."documentId" = doc_updates."documentId"
        AND dm."userId" = current_setting('app.current_user_id', true)
    )
  );

DROP POLICY IF EXISTS doc_updates_insert ON doc_updates;
CREATE POLICY doc_updates_insert ON doc_updates
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_members dm
      WHERE dm."documentId" = doc_updates."documentId"
        AND dm."userId" = current_setting('app.current_user_id', true)
        AND dm.role IN ('OWNER', 'EDITOR')
    )
  );

DROP POLICY IF EXISTS doc_versions_isolation ON doc_versions;
CREATE POLICY doc_versions_isolation ON doc_versions
  USING (
    EXISTS (
      SELECT 1 FROM document_members dm
      WHERE dm."documentId" = doc_versions."documentId"
        AND dm."userId" = current_setting('app.current_user_id', true)
    )
  );
