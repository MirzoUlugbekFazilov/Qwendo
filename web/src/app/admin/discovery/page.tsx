import { DiscoveryActionForm } from "@/components/discovery-action-form";
import { request } from "@/lib/api";
import { adminToken } from "./access";
import { saveDiscovery } from "./actions";

type Source = { slug: string; kind: string; permission: string; enabled: boolean; url: string;
  allowed_hosts: string[]; config: object; interval_minutes: number; last_success_at: string | null };
type Dashboard = { sources: Source[]; keywords: ({ slug: string } & Record<string, unknown>)[];
  submissions: { id: string; url: string; title?: string; notes?: string; status: string }[];
  jobs: object[]; reviews: object[]; coverage: object; metrics: object };

function SourceForm({ source }: { source?: Source }) {
  return <DiscoveryActionForm action={saveDiscovery.bind(null, "sources")} label="Save source">
    <label>Source identifier<input name="slug" defaultValue={source?.slug} readOnly={!!source} required /></label>
    <label>Kind<select name="kind" defaultValue={source?.kind}>
      {["ticketmaster", "jsonld", "rss", "ical", "search"].map(k => <option key={k}>{k}</option>)}
    </select></label>
    <label>Source URL<input name="url" type="url" defaultValue={source?.url} required /></label>
    <label>Allowed hosts (comma separated)<input name="allowed_hosts" defaultValue={source?.allowed_hosts.join(", ")} required /></label>
    <label>Permission<textarea name="permission" defaultValue={source?.permission} /></label>
    <label>Configuration (JSON)<textarea name="config" defaultValue={JSON.stringify(source?.config ?? {}, null, 2)} /></label>
    <label>Check interval (minutes)<input name="interval_minutes" type="number" min={1} max={525600} defaultValue={source?.interval_minutes ?? 60} required /></label>
    <label><input name="enabled" type="checkbox" defaultChecked={source?.enabled} /> Enabled</label>
  </DiscoveryActionForm>;
}

function Monitor({ value }: { value: object }) {
  const rows: Record<string, unknown>[] = Array.isArray(value) ? value : [value];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row ?? {})))];
  if (!columns.length) return <p className="text-mist-400">No records.</p>;
  return <div className="surface overflow-x-auto rounded-card"><table className="w-full text-left text-sm">
    <thead><tr>{columns.map(col => <th className="p-3 font-semibold" key={col}>{col.replaceAll("_", " ")}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-ink-800">{columns.map(col =>
      <td key={col} className="max-w-sm break-words p-3">{row[col] == null ? "—" : typeof row[col] === "object"
        ? JSON.stringify(row[col]) : String(row[col])}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default async function DiscoveryAdmin() {
  const token = await adminToken();
  const data = await request<Dashboard>("/v1/admin/discovery", { token });
  return <section className="mx-auto max-w-4xl space-y-6 px-4 py-12 [&_h2]:text-2xl [&_summary]:cursor-pointer">
    <h1 className="font-display text-3xl font-bold">Discovery administration</h1>
    <h2>Sources and schedules</h2>
    {data.sources.map(source => <details key={source.slug}>
      <summary>{source.slug} · {source.enabled ? "Enabled" : "Disabled"} · Every {source.interval_minutes} min · Last success {source.last_success_at ?? "—"}</summary>
      <SourceForm source={source} />
    </details>)}
    <details><summary>Add source</summary><SourceForm /></details>
    <h2>Keyword dictionary</h2>
    {[...data.keywords, null].map(row => {
      const { slug, ...entry } = row ?? {};
      return <details key={slug ?? "new-keyword"}><summary>{slug ?? "Add keyword"}</summary>
        <DiscoveryActionForm action={saveDiscovery.bind(null, "keywords")} label="Save keyword">
          <label>Keyword identifier<input name="slug" defaultValue={slug} readOnly={!!row} required /></label>
          <label>Dictionary entry (JSON)<textarea name="entry" rows={5} defaultValue={JSON.stringify(entry, null, 2)} required /></label>
        </DiscoveryActionForm>
      </details>;
    })}
    <h2>Organiser submissions</h2>
    {!data.submissions?.length && <p>No submissions.</p>}
    {data.submissions?.map(item => <article key={item.id} className="space-y-2">
      <h3>{item.title || item.url}</h3><p className="break-all">{item.url} · {item.status}</p>
      {item.notes && <p>{item.notes}</p>}
      {item.status === "pending_review" && <DiscoveryActionForm action={saveDiscovery.bind(null, "submissions")} label="Apply review">
        <input type="hidden" name="slug" value={item.id} />
        <label>Decision<select name="decision"><option value="queue">Queue for verification</option><option value="reject">Reject</option></select></label>
        <label>Permitted source<select name="source_slug"><option value="">Select a source</option>
          {data.sources.filter(s => s.enabled).map(s => <option key={s.slug}>{s.slug}</option>)}</select></label>
      </DiscoveryActionForm>}
    </article>)}
    {(["metrics", "coverage", "jobs", "reviews"] as const).map(key => <section key={key}>
      <h2 className="capitalize">{key}</h2>
      <Monitor value={data[key]} />
    </section>)}
  </section>;
}
