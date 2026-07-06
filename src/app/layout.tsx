import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local-First Collaborative Editor",
  description: "Offline-first document editor with CRDT sync and version time-travel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>

          {/* Required by submission guidelines: name + profile links */}
          <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
            Built by{" "}
            <span className="font-medium text-foreground">YOUR_NAME_HERE</span> ·{" "}
            <a
              href="https://github.com/YOUR_GITHUB_HANDLE"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>{" "}
            ·{" "}
            <a
              href="https://www.linkedin.com/in/YOUR_LINKEDIN_HANDLE"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn
            </a>
          </footer>
        </div>
      </body>
    </html>
  );
}
