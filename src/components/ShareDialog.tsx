"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { UserPlus, X } from "lucide-react";

export function ShareDialog({ documentId }: { documentId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("EDITOR");
  const [message, setMessage] = useState<string | null>(null);

  const share = async () => {
    setMessage(null);
    const res = await fetch(`/api/documents/${documentId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const body = await res.json();
    setMessage(res.ok ? `Shared as ${role}` : body.error ?? "Failed to share");
  };

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm">
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Share
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold">Share document</Dialog.Title>
            <Dialog.Close aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <label htmlFor="share-email" className="mb-1 block text-xs font-medium">
            Email
          </label>
          <input
            id="share-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-3 w-full rounded-md border border-border px-2 py-1.5 text-sm"
            placeholder="colleague@example.com"
          />

          <fieldset className="mb-4">
            <legend className="mb-1 text-xs font-medium">Role</legend>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={role === "EDITOR"} onChange={() => setRole("EDITOR")} /> Editor
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={role === "VIEWER"} onChange={() => setRole("VIEWER")} /> Viewer
              </label>
            </div>
          </fieldset>

          <button onClick={share} className="w-full rounded-md bg-primary py-1.5 text-sm text-primary-foreground">
            Send invite
          </button>
          {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
