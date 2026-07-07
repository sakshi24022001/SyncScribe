"use client";

/**
 * Split into an outer default export (wrapped in Suspense) and an inner
 * component that actually calls useSearchParams(). Next.js requires any
 * component using useSearchParams() to sit inside a Suspense boundary,
 * since the hook depends on client-side URL data that isn't available
 * during static prerendering — without the boundary, the build fails
 * with "useSearchParams() should be wrapped in a suspense boundary."
 */
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const params = useSearchParams();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn("credentials", {
      email,
      password,
      callbackUrl: params.get("callbackUrl") ?? "/documents",
    });
  };

  return (
    <main className="mx-auto mt-24 max-w-sm p-6">
      <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm">Email</label>
          <input id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm">Password</label>
          <input id="password" type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="w-full rounded-md bg-primary py-2 text-sm text-primary-foreground">
          Sign in
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <a href="/register" className="underline hover:text-foreground">
          Create one
        </a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto mt-24 max-w-sm p-6 text-sm text-muted-foreground">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
