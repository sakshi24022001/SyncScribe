import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Root route. Not a real "home page" for this assignment scope — just
 * routes signed-in users to their document list and everyone else to
 * login. A real product would show a marketing/landing page here.
 */
export default async function RootPage() {
  const session = await auth();
  redirect(session?.user ? "/documents" : "/login");
}
