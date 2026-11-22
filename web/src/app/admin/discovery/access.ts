import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function adminToken() {
  const auth = (await createClient()).auth;
  const { data: { session } } = await auth.getSession();
  if (!session) redirect("/login?next=/admin/discovery");
  const { data: { user } } = await auth.getUser(session.access_token);
  if (user?.app_metadata?.qwendo_admin !== true) notFound();
  return session.access_token;
}
