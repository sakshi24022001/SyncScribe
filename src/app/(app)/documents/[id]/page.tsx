"use client";

import { use } from "react";
import { useDocument } from "@/hooks/useDocument";
import { Editor } from "@/components/Editor";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { VersionHistory } from "@/components/VersionHistory";
import { ShareDialog } from "@/components/ShareDialog";

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ytext, status, ready } = useDocument(id);

  // In a full build this comes from a server component fetch of
  // DocumentMember.role for the session user; simplified here for clarity.
  function getPlaceholderRole(): "OWNER" | "EDITOR" | "VIEWER" {
    return "OWNER";
  }

  // inside the component:
  const role = getPlaceholderRole();
  const canEdit = role !== "VIEWER";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold">Document</h1>
        <div className="flex items-center gap-3">
          <ConnectionStatus status={status} />
          <ShareDialog documentId={id} />
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
