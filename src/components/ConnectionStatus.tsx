"use client";

import { CloudOff, Cloud, RefreshCw, AlertTriangle } from "lucide-react";
import type { SyncStatus } from "@/lib/syncEngine";

const CONFIG: Record<SyncStatus, { label: string; className: string; Icon: typeof Cloud }> = {
  offline: { label: "Offline — editing locally", className: "text-amber-600 bg-amber-50", Icon: CloudOff },
  syncing: { label: "Syncing…", className: "text-blue-600 bg-blue-50", Icon: RefreshCw },
  synced: { label: "All changes saved", className: "text-emerald-600 bg-emerald-50", Icon: Cloud },
  error: { label: "Sync error — retrying", className: "text-red-600 bg-red-50", Icon: AlertTriangle },
};

export function ConnectionStatus({ status }: { status: SyncStatus }) {
  const { label, className, Icon } = CONFIG[status];
  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${className}`}
    >
      <Icon className={`h-3.5 w-3.5 ${status === "syncing" ? "animate-spin" : ""}`} aria-hidden="true" />
      {label}
    </div>
  );
}
