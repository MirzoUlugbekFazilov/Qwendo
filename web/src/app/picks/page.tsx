import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccessToken } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api";
import { getPicks, getPickState } from "@/components/picks-api";
import { PicksDashboard } from "@/components/picks-dashboard";

export const metadata = { title: "Top Picks" };

export default async function PicksPage() {
  const token = await getAccessToken();
  if (!token) redirect("/login?next=/picks");
  try {
    const [data, saved, going] = await Promise.all([
      getPicks(token), getPickState(token, "saved"), getPickState(token, "going"),
    ]);
    return <PicksDashboard data={data} now={Date.now()} initialStates={Object.fromEntries([
      ...saved.items.map(event => [event.id, "saved"]),
      ...going.items.map(event => [event.id, "going"]),
    ])} />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/login?next=/picks");
    return <section className="mx-auto max-w-5xl space-y-4 px-4 py-12">
      <h1 className="font-display text-3xl font-bold">Your picks couldn’t load</h1>
      <a href="/picks" className="btn btn-primary">Try again</a>
      <Link href="/discover" className="btn btn-ghost">Browse events</Link>
    </section>;
  }
}
