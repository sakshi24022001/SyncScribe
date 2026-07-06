"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
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
    </main>
  );
}
