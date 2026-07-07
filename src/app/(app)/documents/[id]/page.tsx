"use client";

import { use } from "react";
import { useDocument } from "@/hooks/useDocument";
import { Editor } from "@/components/Editor";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { VersionHistory } from "@/components/VersionHistory";
import { ShareDialog } from "@/components/ShareDialog";
import { LogoutButton } from "@/components/LogoutButton";
import { ArrowLeft } from "lucide-react";

/**
 * Stand-in for a real server-side role lookup. Returning it from a
 * function (rather than assigning a literal directly to a `const`)
 * avoids TypeScript narrowing the variable to a single literal type via
 * control-flow analysis, which otherwise makes `role !== "VIEWER"` look
 * like an impossible comparison at build time.
 */
function getPlaceholderRole(): "OWNER" | "EDITOR" | "VIEWER" {
  return "OWNER";
}

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ytext, status, ready } = useDocument(id);

  // In a full build this comes from a server component fetch of
  // DocumentMember.role for the session user; simplified here for clarity.
  // Resolved via a function call (rather than a direct literal `const`)
  // so TypeScript doesn't narrow `role` to a single literal type during
  // control-flow analysis — that narrowing is what caused the earlier
  // "no overlap" build error on `role !== "VIEWER"`.
  const role = getPlaceholderRole();
  const canEdit = role !== "VIEWER";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <a
            href="/documents"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            aria-label="Back to documents"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Documents
          </a>
          <h1 className="text-lg font-semibold">Document</h1>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionStatus status={status} />
          <ShareDialog documentId={id} />
          <LogoutButton />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto p-6">
          {!ready ? (
            <p className="text-sm text-muted-foreground">Loading from local storage…</p>
          ) : (
            <Editor ytext={ytext} editable={canEdit} />
          )}
        </main>
        <VersionHistory documentId={id} canRestore={canEdit} />
      </div>
    </div>
  );
}
