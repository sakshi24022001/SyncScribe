"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus, FileText } from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";

interface DocSummary {
  id: string;
  title: string;
  role: string;
  updatedAt: string;
}

export default function DocumentsListPage() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/documents");
      if (res.ok) {
        const body = await res.json();
        setDocs(body.documents);
      }
      setLoading(false);
    })();
  }, []);

  const createDoc = async () => {
    const title = window.prompt("Document title:", "Untitled Document") ?? "Untitled Document";
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const body = await res.json();
      router.push(`/documents/${body.document.id}`);
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your Documents</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={createDoc}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            <FilePlus className="h-4 w-4" aria-hidden="true" /> New document
          </button>
          <LogoutButton />
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && docs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No documents yet — create one to get started.
        </p>
      )}

      <ul className="space-y-2">
        {docs.map((doc) => (
          <li key={doc.id}>
            <a
              href={`/documents/${doc.id}`}
              className="flex items-center gap-2 rounded-md border border-border p-3 text-sm hover:bg-muted-foreground/5"
            >
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{doc.title}</span>
              <span className="text-xs text-muted-foreground">{doc.role}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
