"use client";

/**
 * VersionHistory — lists captured snapshots and lets an OWNER/EDITOR
 * restore one. Restoring calls the server route which appends a
 * merge-safe CRDT update (see restore/route.ts) — the client does not
 * attempt to reconstruct history locally, since the server holds the
 * canonical update log needed to compute a correct diff.
 */
import { useEffect, useState, useCallback } from "react";
import { History, RotateCcw, Save } from "lucide-react";

interface VersionEntry {
  id: string;
  label: string | null;
  seqAtCapture: number;
  createdAt: string;
  author: { name: string | null; email: string };
}

export function VersionHistory({ documentId, canRestore }: { documentId: string; canRestore: boolean }) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/documents/${documentId}/versions`);
    if (res.ok) {
      const body = await res.json();
      setVersions(body.versions);
    }
  }, [documentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capture = async () => {
    setLoading(true);
    const label = window.prompt("Label this version (optional):") ?? undefined;
    await fetch(`/api/documents/${documentId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    await refresh();
    setLoading(false);
  };

  const restore = async (versionId: string) => {
    if (!window.confirm("Restore this version? This adds a new update on top of the current document — nothing is deleted.")) {
      return;
    }
    setLoading(true);
    await fetch(`/api/documents/${documentId}/versions/${versionId}/restore`, { method: "POST" });
    await refresh();
    setLoading(false);
  };

  return (
    <aside className="w-72 shrink-0 border-l border-border p-4" aria-label="Version history">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <History className="h-4 w-4" aria-hidden="true" /> Version History
        </h2>
        <button
          onClick={capture}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
        >
          <Save className="h-3 w-3" aria-hidden="true" /> Capture
        </button>
      </div>

      <ol className="space-y-2">
        {versions.map((v) => (
          <li key={v.id} className="rounded-md border border-border p-2 text-xs">
            <div className="font-medium">{v.label ?? `Snapshot @ seq ${v.seqAtCapture}`}</div>
            <div className="text-muted-foreground">
              {v.author.name ?? v.author.email} · {new Date(v.createdAt).toLocaleString()}
            </div>
            {canRestore && (
              <button
                onClick={() => restore(v.id)}
                disabled={loading}
                className="mt-1 inline-flex items-center gap-1 text-blue-600 hover:underline disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" /> Restore
              </button>
            )}
          </li>
        ))}
        {versions.length === 0 && <p className="text-xs text-muted-foreground">No versions captured yet.</p>}
      </ol>
    </aside>
  );
}
