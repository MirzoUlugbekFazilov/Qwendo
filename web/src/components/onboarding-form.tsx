"use client";

import { useEffect, useRef, useState } from "react";
import { availability, categories, defaultRadarPreferences, formats, motivations, notice, notifications, priorityLabels, steps,
  type DiscoveryProfile, type DiscoveryInterest, type RadarPreferences } from "@/lib/discovery-profile";
import { OnboardingInterests } from "./onboarding-interests";
import { useDiscoverySession } from "./onboarding-session";
import "./onboarding.css";

function Choices({ title, options, selected, change }: {
  title: string; options: Record<string, string>; selected: string[]; change: (values: string[]) => void;
}) {
  return <fieldset><legend>{title}</legend><div className="choices">
    {Object.entries(options).map(([key, label]) => {
      const active = selected.includes(key);
      return <button key={key} type="button" className="choice" aria-pressed={active}
        onClick={() => change(active ? selected.filter(v => v !== key) : [...selected, key])}>
        <span aria-hidden="true">{active ? "✓" : "+"}</span>{label}
      </button>;
    })}
  </div></fieldset>;
}

function Toggle({ label, checked, change }: { label: string; checked: boolean; change: (v: boolean) => void }) {
  return <label className="toggle"><input type="checkbox" checked={checked}
    onChange={e => change(e.target.checked)} /> {label}</label>;
}

function Review({ p, edit }: { p: DiscoveryProfile; edit: (step: number) => void }) {
  const firmness = (strict: boolean) => strict ? " (firm limit)" : "";
  const delivery = p.radar_preferences ?? defaultRadarPreferences;
  const rows = [
    p.categories.map(k => categories[k]).join(", "),
    [p.text, ...p.interests.map(i => [i.name, priorityLabels[i.priority],
      i.source === "inferred" ? (i.confirmed ? "inferred, confirmed" : "inferred, unconfirmed") : "explicit"].join(" · "))].filter(Boolean).join("\n"),
    [p.motivations.join(", "), p.formats.join(", ")].filter(Boolean).join("\n"),
    [p.city || "City needed", p.radius + " miles", p.online && "Include online events", p.flexible_travel && "Flexible travel"].filter(Boolean).join(" · "),
    [(p.budget === null ? "Any budget" : p.budget === 0 ? "Free events" : "Up to £" + p.budget) + firmness(p.budget_strict),
      p.availability + firmness(p.availability_strict), p.notice + firmness(p.notice_strict)].join(" · "),
    [p.radar, `Radar delivery · ${delivery.frequency}`,
      delivery.quiet_start && `Quiet hours · ${delivery.quiet_start}–${delivery.quiet_end} (${delivery.timezone})`,
      ...Object.entries(notifications).map(([k, label]) =>
      label + " — " + (p.notifications[k as keyof typeof notifications] ? "On" : "Off"))].filter(Boolean).join("\n"),
  ];
  return <div>{rows.map((row, i) => <section className="review-row" key={i}>
    <div className="flex items-baseline justify-between gap-3"><h2>{steps[i][0]}</h2>
      <button className="link" onClick={() => edit(i + 1)} aria-label={"Edit " + steps[i][0]}>Edit</button></div>
    <p className="whitespace-pre-line break-words">{row || "Skipped"}</p>
  </section>)}</div>;
}

const labels = (options: string[]) => Object.fromEntries(options.map(v => [v, v]));

export function OnboardingForm() {
  const session = useDiscoverySession();
  const { draft, update } = session;
  const [editing, setEditing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = draft?.step;
  useEffect(() => { if (step) heading.current?.focus(); }, [step]);
  if (!draft || !step) return <div className="wizard mx-auto max-w-3xl px-5 py-16">
    {session.loadFailed ? <><h1>Couldn’t load your discovery profile</h1>
      <button className="btn btn-primary mt-4" onClick={session.reload}>Try again</button></> :
      <p role="status">Loading your discovery profile…</p>}
  </div>;
  const p = draft.profile;
  const delivery = p.radar_preferences ?? defaultRadarPreferences;
  const changeDelivery = (patch: Partial<RadarPreferences>) => update({ radar_preferences: { ...delivery, ...patch } });
  const review = step === 7;
  const topicNeeded = !p.categories.length && !p.interests.some(i => i.name.trim() && i.source === "explicit");
  const cityNeeded = !p.city.trim();
  function go(n: number) { update({}, n); }
  function next() { go(editing ? 7 : step! + 1); setEditing(false); }
  return <div className="wizard mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-14">
    <div className="wizard-frame">
      <aside aria-label="Onboarding progress">
        <strong>Your discovery profile</strong>
        <ol>{[...steps.map(s => s[0]), "Review"].map((label, i) =>
          <li key={label} aria-current={step === i + 1 ? "step" : undefined}>
            <span className="marker">{i === 6 ? "✓" : i + 1}</span><span>{label}</span>
          </li>)}</ol>
      </aside>
      <fieldset disabled={session.finishing} className="min-w-0 px-5 py-7 sm:p-9">
        <header><p className="eyebrow">{review ? "Review" : "Step " + step + " of 6"}</p>
          <h1 ref={heading} tabIndex={-1}>{review ? "Review your discovery profile" : steps[step - 1][1]}</h1>
          <p>{review ? "Saving accepts the explicit interests listed here. Confirmed inferred interests also personalise your picks. Unconfirmed suggestions can help you explore. Only interests you mark Must not miss get Radar priority." : steps[step - 1][2]}</p>
        </header>
        <div key={step} className="wizard-step space-y-6">
          {step === 1 && <Choices title="Categories" options={categories} selected={p.categories} change={categories => update({ categories })} />}
          {step === 1 && <a className="link inline-block" href="/#matching-demo" target="_blank" rel="noreferrer">Try the matching demo (opens in a new tab)</a>}
          {(step === 2 || step === 6) && <OnboardingInterests key={step} radar={step === 6} profile={p} update={update} extract={() =>
            session.request<{ interests: DiscoveryInterest[]; mode: string }>("/extract", "POST", {
              text: step === 6 ? p.radar : p.text, categories: p.categories,
            })} />}
          {step === 3 && <><Choices title="What brings you to an event?" options={labels(motivations)} selected={p.motivations} change={motivations => update({ motivations })} />
            <Choices title="What kinds of experiences do you enjoy?" options={labels(formats)} selected={p.formats} change={formats => update({ formats })} /></>}
          {step === 4 && <><label>City<input autoComplete="address-level2" required maxLength={120}
            placeholder="e.g. London" value={p.city} onChange={e => update({ city: e.target.value })} /></label>
            <label>Travel radius<select aria-label="Travel radius" value={p.radius} onChange={e => update({ radius: Number(e.target.value) })}>
              {[5,10,25,50,100].map(n => <option value={n} key={n}>{n} miles</option>)}</select></label>
            <Toggle label="Include online events" checked={p.online} change={online => update({ online })} />
            <Toggle label="Only show in-person events within my travel radius" checked={!p.flexible_travel} change={strict => update({ flexible_travel: !strict })} /></>}
          {step === 5 && <><div><label>Ticket budget<select aria-label="Ticket budget" value={p.budget ?? ""} onChange={e => update({ budget: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Any budget</option>{[0,20,50,100].map(n => <option key={n} value={n}>{n ? "Up to £" + n : "Free events"}</option>)}</select></label>
            <Toggle label="Only show events within my budget" checked={p.budget_strict} change={budget_strict => update({ budget_strict })} /></div>
            {(["availability", "notice"] as const).map(key => <div key={key}><label>{key === "availability" ? "Availability" : "Advance notice"}
              <select aria-label={key === "availability" ? "Availability" : "Advance notice"} value={p[key]} onChange={e => update({ [key]: e.target.value })}>
                {(key === "availability" ? availability : notice).map(v => <option key={v}>{v}</option>)}</select></label>
              <Toggle label={key === "availability" ? "Only show events during these times" : "Only show events with this much notice"}
                checked={p[`${key}_strict`]} change={v => update({ [key + "_strict"]: v })} /></div>)}</>}
          {step === 6 && <><fieldset><legend>In-app notification preferences</legend>
            <p>These updates appear in Qwendo.</p>{Object.entries(notifications).map(([key, label]) =>
              <Toggle key={key} label={label} checked={p.notifications[key as keyof typeof notifications]}
                change={v => update({ notifications: { ...p.notifications, [key]: v } })} />)}</fieldset>
            <fieldset className="space-y-3"><legend>Radar delivery</legend>
              <label>Delivery frequency<select value={delivery.frequency}
                onChange={e => changeDelivery({ frequency: e.target.value as RadarPreferences["frequency"] })}>
                <option value="immediate">Immediate</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
              </select></label>
              <label>Delivery time zone<select value={delivery.timezone} onChange={e => changeDelivery({ timezone: e.target.value })}>
                {[...new Set(["UTC", delivery.timezone, ...Intl.supportedValuesOf("timeZone")])].map(zone =>
                  <option key={zone}>{zone}</option>)}
              </select></label>
              <Toggle label="Use quiet hours" checked={!!delivery.quiet_start}
                change={enabled => changeDelivery(enabled ? { quiet_start: "22:00", quiet_end: "07:00" }
                  : { quiet_start: undefined, quiet_end: undefined })} />
              {delivery.quiet_start && (["quiet_start", "quiet_end"] as const).map(key =>
                <label key={key}>{key === "quiet_start" ? "Quiet hours start" : "Quiet hours end"}
                  <input type="time" value={delivery[key] ?? ""} onChange={e => {
                    if (e.target.value) changeDelivery({ [key]: e.target.value });
                  }} /></label>)}
            </fieldset></>}
          {review && <Review p={p} edit={n => { setEditing(true); go(n); }} />}
        </div>
        <footer>
          {review && (topicNeeded || cityNeeded) && <p role="status">{[topicNeeded && "Choose a category or add an explicit interest.", cityNeeded && "Enter your city."].filter(Boolean).join(" ")}</p>}
          {session.saveFailed && <p role="alert">Couldn’t save your profile. Your choices are here. Try saving again.</p>}
          {/* Save state belongs beside the actions, not dangling beneath the
              button it has nothing to do with: it reports on the draft, which
              is saved continuously, while the button moves you on. */}
          <div className="flex flex-wrap items-center gap-3">
            {step > 1 && <button className="link" onClick={() => { go(editing ? 7 : step - 1); setEditing(false); }}>Back</button>}
            <p className="save-state"><span role="status">{session.status}</span>
              {session.status === "Draft could not be saved" && <button className="link" onClick={session.retryDraft}>Retry</button>}
            </p>
            <div className="ml-auto flex flex-wrap gap-3">
              {!review && step !== 4 && !editing && <button className="link" onClick={next}>Skip for now</button>}
              <button className="btn btn-primary" disabled={review ? topicNeeded || cityNeeded : step === 4 && cityNeeded}
                onClick={review ? session.finish : next}>{review ? (session.finishing ? "Saving…" : "Save and see my picks") :
                  editing ? "Return to review" : step === 6 ? "Review profile" : "Continue"}</button>
            </div>
          </div>
        </footer>
      </fieldset>
    </div>
  </div>;
}
