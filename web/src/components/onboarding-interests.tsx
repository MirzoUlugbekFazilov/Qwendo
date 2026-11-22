"use client";

import { useEffect, useRef, useState } from "react";
import { explicitInterest, priorityLabels, type DiscoveryInterest, type DiscoveryProfile } from "@/lib/discovery-profile";

type Props = {
  profile: DiscoveryProfile;
  radar?: boolean;
  update: (patch: Partial<DiscoveryProfile>) => void;
  extract: () => Promise<{ interests: DiscoveryInterest[]; mode: string }>;
};

const suggestions: Record<string, string> = {
  tech: "Creative coding", film: "Independent cinema", music: "Live jazz", business: "Startups",
  gaming: "Indie games", sports: "Women's football", arts: "Ceramics", food: "Street food",
  education: "Astronomy", fashion: "Vintage fashion", comedy: "Stand-up", wellness: "Trail walking",
};

const aliases: Record<string, string> = {
  ai: "artificial intelligence", ml: "machine learning", f1: "formula 1", "formula one": "formula 1",
  scifi: "science fiction", "sci-fi": "science fiction", kpop: "k-pop",
  dnb: "drum and bass", "d&d": "dungeons & dragons",
};

function topicKey(value: string) {
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  return aliases[key] ?? key;
}

export function OnboardingInterests({ profile, update, extract, radar = false }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const { interests } = profile;
  const mustCount = interests.filter(i => i.priority === "must").length;
  const names = new Set(interests.map(i => topicKey(i.name)));
  const field = radar ? "radar" : "text";
  const query = name.trim().toLowerCase();
  const candidates = [...new Set([...profile.categories.map(c => suggestions[c]), ...Object.values(suggestions),
    "Artificial Intelligence", "Machine Learning", "Formula 1", "Science Fiction", "K-pop", "Drum and Bass", "Dungeons & Dragons"])];
  const matches = candidates.filter(value => value && !names.has(topicKey(value)) &&
    (!query || value.toLowerCase().includes(query) || topicKey(value).includes(topicKey(query)))).slice(0, 6);
  function add(value: string) {
    const trimmed = value.trim();
    if (!trimmed || names.has(topicKey(trimmed)) || interests.length >= 64) return;
    update({ interests: [...interests, explicitInterest(trimmed)] });
    setName("");
  }
  function edit(index: number, patch: Partial<DiscoveryInterest>) {
    update({ interests: interests.map((i, n) => n === index ? { ...i, ...patch } : i) });
  }
  async function suggest() {
    setBusy(true);
    setMessage("");
    try {
      const result = await extract();
      if (!active.current) return;
      const fresh: DiscoveryInterest[] = [];
      const parser = result.mode === "fallback" ? "The local text parser was used. " : "";
      for (const item of result.interests) {
        if (interests.length + fresh.length >= 64) break;
        const key = topicKey(item.name);
        if (!key || names.has(key)) continue;
        names.add(key);
        const priority = item.priority === "must" ? "very" : item.priority;
        fresh.push({ ...item, priority, confirmed: item.source === "explicit" && item.confirmed });
      }
      update({ interests: [...interests, ...fresh] });
      setMessage(parser + (fresh.length ? "Review the interests below." : "No additional interests found."));
    } catch {
      if (active.current) setMessage("Suggestions couldn’t load. Try again or add an interest below.");
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return <fieldset disabled={busy} className="space-y-5">
    <label>{radar ? "My radar" : "In your own words"}<textarea rows={3} value={profile[field]} maxLength={4000}
      placeholder={radar ? "I’d hate to miss a Studio Ghibli retrospective in London." : "I’m into short films, ambient music and anything by Studio Ghibli."}
      onChange={e => update({ [field]: e.target.value })} /></label>
    <p id="extraction-help">We match words in your text to known topics. You can edit, confirm or remove each suggestion.</p>
    <button className="btn btn-secondary" aria-describedby="extraction-help" disabled={!profile[field].trim() || interests.length >= 64} onClick={suggest}>
      {busy ? "Finding suggestions…" : radar ? "Suggest radar interests" : "Suggest interests from my text"}
    </button>
    <p role="status">{message}</p>
    <form onSubmit={e => { e.preventDefault(); add(name); }}>
      <label htmlFor="custom-interest">Search suggested topics or add your own</label>
      <div className="flex items-center gap-2"><input id="custom-interest" maxLength={160} value={name}
        placeholder="Artist, team, topic or community" onChange={e => setName(e.target.value)} />
        <button className="btn btn-secondary" disabled={!name.trim() || names.has(topicKey(name)) || interests.length >= 64}>Add</button></div>
      {query && names.has(topicKey(name)) && <p role="status">Already in your interests.</p>}
    </form>
    <div className="flex flex-wrap gap-2" aria-label="Suggested interests">
      {matches.map(value => <button key={value} className="choice" disabled={interests.length >= 64} onClick={() => add(value)}>+ {value}</button>)}
    </div>
    {interests.length > 0 && <p>Must not miss · {mustCount} of 3 selected. Confirm inferred interests before giving them this priority.</p>}
    {interests.map((item, i) => <fieldset className="interest" key={i}>
      <legend>{item.source === "inferred" ? "Inferred interest" : "Explicit interest"} · {i + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Interest name<input key={item.name} maxLength={160} defaultValue={item.name} onBlur={e => {
          const value = e.target.value.trim();
          if (!value || interests.some((other, n) => n !== i && topicKey(other.name) === topicKey(value))) {
            e.target.value = item.name;
            setMessage("Use a unique, non-empty interest name.");
          } else if (value !== item.name) edit(i, { name: value });
        }} /></label>
        <label>Priority<select aria-label="Priority" value={item.priority} onChange={e => edit(i, { priority: e.target.value as DiscoveryInterest["priority"],
          confirmed: item.confirmed || e.target.value === "must" })}>
          {Object.entries(priorityLabels).map(([key, label]) =>
            <option key={key} value={key} disabled={key === "must" && ((mustCount >= 3 && item.priority !== "must") ||
              (item.source === "inferred" && !item.confirmed))}>{label}</option>)}
        </select></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {item.source === "inferred" && <label><input type="checkbox" checked={item.confirmed}
          onChange={e => edit(i, { confirmed: e.target.checked, priority: !e.target.checked && item.priority === "must" ? "very" : item.priority })} /> Confirm this interest</label>}
        <button className="link" aria-label={"Remove " + item.name} onClick={() => update({ interests: interests.filter((_, n) => n !== i) })}>Remove</button>
      </div>
    </fieldset>)}
  </fieldset>;
}
