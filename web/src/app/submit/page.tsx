import { redirect } from "next/navigation";
import { DiscoveryActionForm } from "@/components/discovery-action-form";
import { ApiError, request } from "@/lib/api";
import { getAccessToken, getUser } from "@/lib/supabase/server";

async function submitEvent(_: string, form: FormData) {
  "use server";
  const token = await getAccessToken();
  if (!token) redirect("/login?next=/submit");
  try {
    await request("/v1/discovery/submissions", { method: "POST", token, body: {
      url: String(form.get("url") ?? "").trim(),
      title: String(form.get("title") ?? "").trim() || undefined,
      notes: String(form.get("notes") ?? "").trim() || undefined,
    } });
    return "Submitted for review.";
  } catch (error) {
    return error instanceof ApiError ? error.message : "Couldn’t submit the event. Try again.";
  }
}

export default async function SubmitPage() {
  if (!await getUser()) redirect("/login?next=/submit");
  return <section className="mx-auto max-w-xl space-y-5 px-4 py-12">
    <h1 className="font-display text-3xl font-bold">Submit an event</h1>
    <p>Share the organiser’s official listing. A reviewer checks the source before the event can appear in discovery.</p>
    <DiscoveryActionForm action={submitEvent} label="Submit for review">
      <label>Official event URL<input name="url" type="url" pattern="https://.+" placeholder="https://" maxLength={2000} required /></label>
      <label>Event title (optional)<input name="title" maxLength={200} /></label>
      <label>Notes for the reviewer (optional)<textarea name="notes" maxLength={1500} rows={3} /></label>
    </DiscoveryActionForm>
  </section>;
}
