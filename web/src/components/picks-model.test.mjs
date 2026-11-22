import assert from "node:assert/strict";
import test from "node:test";
import { officialLinks, pickSections, sourceListing } from "./picks-model.ts";

import { calendarLabel, eventZone, formatDate, formatDayBadge, formatTime } from "../lib/format.ts";

test("source attribution preserves verified syndicator URLs without promoting them to booking", () => {
  const event = { verification_status: "verified", url: "https://publisher.example/event", official_url: null };
  assert.equal(sourceListing(event), event.url);
  assert.deepEqual(officialLinks(event), []);
  assert.equal(sourceListing({ ...event, official_url: event.url }), null);
  assert.equal(sourceListing({ ...event, official_url: "https://venue.example/event" }), event.url);
  assert.equal(sourceListing({ ...event, verification_status: "pending_review" }), null);
  assert.equal(sourceListing({ ...event, url: "javascript:alert(1)" }), null);
});

test("explicit offsets preserve the event's local time and day across UTC midnight", () => {
  const start = "2030-04-01T00:15:00+05:45";
  for (const timezone of [null, "UTC+05:45", "+05:45"]) {
    const zone = eventZone({ timezone, starts_at: start });
    assert.equal(formatTime(start, zone), "00:15");
    assert.deepEqual(formatDayBadge(start, zone), { day: "1", month: "APR" });
    assert.match(formatDate(start, zone), /1 Apr.*00:15/);
    assert.match(calendarLabel(start, zone), /1 Apr/);
  }
  assert.equal(formatTime("2030-04-01T02:30:00Z", "UTC-03:30"), "23:00");
  assert.equal(formatTime("2030-07-01T18:00:00Z", "Europe/Zurich"), "20:00");
});

test("recent discoveries use discovery time and retain separate exploratory picks", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const older = { source_published_at: new Date(now).toISOString(), id: "older", matched_interest: "Jazz", starts_at: new Date(now).toISOString() };
  const newest = { id: "newest", exploratory: true, first_seen_at: new Date(now).toISOString() };
  const previous = { ...older, id: "previous", first_seen_at: "2026-11-18T00:00:00Z" };
  const sections = pickSections([older, previous, newest], now);
  assert.equal(sections[1].title, "Recently Discovered");
  assert.deepEqual(sections.map(section => section.events.map(event => event.id)), [
    ["older", "previous"], ["newest", "previous"], ["older", "previous"], ["newest"],
  ]);
});

test("official links require a verified destination and ignore legacy URLs", () => {
  const url = "https://example.com/tickets";
  const verified = { verification_status: "verified", official_url: url };
  assert.deepEqual(officialLinks(verified), [url]);
  for (const status of [undefined, "pending_review", "rejected", "cancelled"])
    assert.deepEqual(officialLinks({ ...verified, verification_status: status }), []);
  for (const unsafe of ["javascript:void(0)", "//host/path", "https://user@host/", null])
    assert.deepEqual(officialLinks({ ...verified, official_url: unsafe, url }), []);
});

test("a large catalogue keeps each dashboard section to one row of cards", () => {
  const now = Date.now();
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: String(index), matched_interest: "Topic " + (index % 10),
    first_seen_at: new Date(now - index).toISOString(), exploratory: index % 2 === 1,
  }));
  const sections = pickSections(items, now);
  assert.equal(sections.length, 5);
  assert.ok(sections.every(section => section.events.length <= 3));
  assert.equal(sections[0].events[0].id, "0");
});
