import unittest
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import get_anon_db, get_current_user
from api.discovery_ranking import rank_events
from api.routers.picks import dashboard_radar, radar_candidates, router


NOW = datetime(2026, 6, 1, 12, tzinfo=UTC)
ALL_ON = dict(alerts=True, digest=True, tickets=True)


def event(id="1", **changes):
    return {"id": id, "source": "ticketmaster", "url": f"https://www.ticketmaster.co.uk/event/{id}",
            "title": "Artificial intelligence conference", "categories": ["tech"], "tags": [],
            "starts_at": (NOW + timedelta(days=2, hours=5)).isoformat(),
            "verification_status": "verified", "last_verified_at": NOW.isoformat(),
            "official_url": changes.get("url", f"https://www.ticketmaster.co.uk/event/{id}"), "status": "active", "timezone": "Europe/London", "city": "London",
            "venue_name": "Town Hall", "first_seen_at": NOW.isoformat(),
            "last_seen_at": NOW.isoformat(), "currency": "GBP", "price_min": 20,
            "raw": {"onsale": NOW.isoformat()}, **changes}


def profile(**changes):
    return {"city": "London", "categories": [], "formats": ["Conferences and talks"],
            "interests": [{"name": "AI", "source": "explicit", "priority": "must", "confirmed": True}],
            "budget": 20, "availability": "Weekday evenings", "notice": "This week", **changes}


class RankingTests(unittest.TestCase):
    def test_score_components(self):
        def score(**changes):
            return rank_events([event()], profile(**changes), [], NOW)[0]["score"]
        self.assertEqual(score(), 1)
        self.assertEqual(score(interests=[]), 0.6)
        self.assertEqual(score(formats=[]), 0.75)
        self.assertEqual(score(formats=[], motivations=["Learn new things"]), 0.75)
        self.assertEqual(score(city="Berlin", flexible_travel=True), 0.85)
        self.assertEqual(score(availability="Weekends", notice="More than a month"), 0.9)
        self.assertEqual(score(budget=0), 0.9)

    def test_verified_syndicated_listing_preserves_attribution_without_booking_link(self):
        publisher = "https://swissdata.example/events/meetup"
        row = event(source="swiss-data", url=publisher, official_url=None)
        item, = rank_events([row], profile(), [], NOW)
        self.assertEqual(item["url"], publisher)
        self.assertIsNone(item["official_url"])
        self.assertEqual(item["official_links"], [])
        self.assertFalse(radar_candidates([item], [row], profile(), ALL_ON, NOW))

    def test_exact_topic_beats_inference_with_same_practical_preferences(self):
        source = event()
        explicit = {"name": "AI", "source": "explicit", "priority": "curious"}
        inferred = {**explicit, "source": "inferred", "priority": "must", "confidence": 1}
        direct = rank_events([source], profile(interests=[explicit]), [], NOW)[0]
        suggestion = rank_events([source], profile(interests=[inferred]), [], NOW)[0]
        self.assertGreater(direct["score"], suggestion["score"])
        self.assertTrue(suggestion["exploratory"])

    def test_custom_weights_normalize_to_unit_interval(self):
        from unittest.mock import patch
        weights = {"topical": 2, "experience": 0, "location": 0, "timing": 0, "budget": 0}
        with patch("api.discovery_ranking.WEIGHTS", weights):
            self.assertEqual(rank_events([event()], profile(), [], NOW)[0]["score"], 1)
            self.assertEqual(rank_events([event()], profile(interests=[]), [], NOW)[0]["score"], 0)

    def test_strict_constraints(self):
        for changes in [dict(budget_strict=True, budget=0),
                        dict(availability_strict=True, availability="Weekends"),
                        dict(notice_strict=True, notice="1–4 weeks")]:
            self.assertEqual(rank_events([event()], profile(**changes), [], NOW), [])
        for changes in [dict(price_min=None), dict(currency="USD")]:
            self.assertEqual(rank_events([event(**changes)], profile(budget_strict=True), [], NOW), [])
        online = event(city=None, is_online=True)
        self.assertFalse(rank_events([online], profile(online=False), [], NOW))
        self.assertTrue(rank_events([online], profile(online=True), [], NOW))

    def test_timezones_and_radius(self):
        strict = profile(availability_strict=True, radius=5)
        utc_friday = event(starts_at="2026-06-05T23:30:00Z", timezone="Asia/Tokyo")
        self.assertFalse(rank_events([utc_friday], strict, [], NOW))
        for zone in ["../London", "Narnia", "/etc/passwd"]:
            self.assertFalse(rank_events([event(timezone=zone)], strict, [], NOW))
            self.assertIsNone(rank_events([event(timezone=zone)], profile(), [], NOW)[0]["timezone"])
        rows = [event(lat=51.51, lng=-.13), event("2", title="Other", lat=51.71, lng=-.13)]
        self.assertEqual([i["id"] for i in rank_events(rows, strict, [], NOW)], ["1"])
        distant = rank_events(rows, {**strict, "flexible_travel": True}, [], NOW)[1]
        self.assertGreater(distant["distance_miles"], 5)

    def test_eligibility_and_learning(self):
        for change in [dict(verification_status="pending_review"), dict(verification_status="cancelled"),
                       dict(last_verified_at=None), dict(raw={"seeded": True}), dict(source="demo"), dict(status="cancelled"),
                       dict(starts_at=NOW.isoformat()), dict(url="https://example.org/search/events")]:
            self.assertFalse(rank_events([event(**change)], profile(), [], NOW))
        history_event = event("2", title="Another conference")
        base = rank_events([event()], profile(interests=[]), [], NOW)[0]["score"]
        scores = {}
        for state in ["dismissed", "saved", "going"]:
            history = [{"event_id": "2", "events": history_event, "state": state}]
            scores[state] = rank_events([event()], profile(interests=[]), history, NOW)[0]["score"]
        self.assertEqual(base, scores["dismissed"])
        self.assertLess(base, scores["saved"])
        self.assertLess(scores["saved"], scores["going"])

    def test_dedupe_links_and_dismissal(self):
        original = event()
        copy = event("2", source="eventbrite", url="https://eventbrite.co.uk/e/1234")
        distinct = event("3", venue_name="Guildhall")
        rows = [original, copy, distinct]
        items = rank_events(rows, profile(), [], NOW)
        self.assertEqual(items, rank_events(list(reversed(rows)), profile(), [], NOW))
        self.assertEqual(items[0]["official_links"], [original["url"], copy["url"]])
        self.assertEqual(len(items), 2)
        history = [{"event_id": "2", "events": copy, "state": "dismissed"}]
        self.assertEqual([i["id"] for i in rank_events(rows, profile(), history, NOW)], ["3"])

    def test_reviewed_only_aliases_and_exploration(self):
        for name, title in [("F1", "Formula One"), ("ML", "Machine Learning"), ("AI", "Artificial Intelligence")]:
            topic = {"name": name, "priority": "very", "source": "explicit"}
            match = rank_events([event(title=title)], profile(interests=[topic]), [], NOW)[0]
            self.assertEqual(match["matched_interest"], name)
            self.assertFalse(match["exploratory"])
            for suggestion in [{**topic, "source": "inferred", "confidence": .9},
                               {**topic, "name": "Adjacent topic", "related": [name]}]:
                item = rank_events([event(title=title)], profile(interests=[suggestion]), [], NOW)[0]
                self.assertTrue(item["exploratory"])
                self.assertIn("Suggested", item["reason"])
        row = event()
        p = profile(interests=[], radar="Artificial intelligence", text="Artificial intelligence")
        items = rank_events([row], p, [], NOW)
        self.assertTrue(items[0]["exploratory"])
        self.assertIsNone(items[0]["matched_interest"])
        self.assertFalse(radar_candidates(items, [row], p, ALL_ON, NOW))

    def test_availability_requires_recognized_source_evidence(self):
        for observed, expected in [("instock", "available"), ("sold_out", "sold out"), ("maybe", "unknown")]:
            row = event(raw={"availability": observed})
            self.assertEqual(rank_events([row], profile(), [], NOW)[0]["availability"], expected)

    def test_radar_sightings_and_sales(self):
        def kinds(settings=ALL_ON, **changes):
            row = event(**changes)
            items = rank_events([row], profile(), [], NOW)
            return {kind for _, kind in radar_candidates(items, [row], profile(), settings, NOW)}
        self.assertEqual(kinds(), {"great_match", "weekly_digest:2026-W23", "ticket_reminder"})
        self.assertEqual(kinds(dict(alerts=False, digest=False, tickets=False)), set())
        self.assertFalse(kinds(last_verified_at=None))
        self.assertFalse(kinds(last_verified_at=(NOW - timedelta(days=8)).isoformat()))
        self.assertFalse(kinds(last_verified_at=(NOW + timedelta(days=1)).isoformat()))
        self.assertNotIn("great_match", kinds(first_seen_at=(NOW - timedelta(days=8)).isoformat()))
        self.assertNotIn("ticket_reminder", kinds(raw={}))
        self.assertNotIn("ticket_reminder", kinds(source="luma"))
        self.assertNotIn("ticket_reminder", kinds(raw={"onsale": "invalid"}))
        self.assertFalse(kinds(url="https://ticketmaster.com.example.org/event/123"))
        self.assertFalse(kinds(url="https://user@www.ticketmaster.com/event/123"))
        self.assertEqual(rank_events([event()], profile(), [], NOW)[0]["availability"], "unknown")

    def test_radar_does_not_reannounce_old_event_from_new_source(self):
        old = event(first_seen_at=(NOW - timedelta(days=90)).isoformat())
        fresh = event("2", source="luma", url="https://lu.ma/abcdefgh")
        rows = [old, fresh]
        p = profile(categories=["tech"])
        items = rank_events(rows, p, [], NOW)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["discovered_at"], old["first_seen_at"])
        self.assertNotIn(("1", "great_match"), radar_candidates(items, rows, p, ALL_ON, NOW))

    def test_independent_category_fallback(self):
        row = event()
        p = profile(interests=[], categories=["tech"])
        items = rank_events([row], p, [], NOW)
        self.assertEqual(items[0]["matched_interest"], "Technology & AI")
        self.assertFalse(items[0]["exploratory"])
        candidates = radar_candidates(items, [row], p, ALL_ON, NOW)
        self.assertIn(("1", "weekly_digest:2026-W23"), candidates)
        self.assertNotIn(("1", "great_match"), candidates)


class FakeDatabase:
    def __init__(self):
        self.token = None
        self.rows = {"events": [event()], "profiles": None, "saved_events": [],
                     "user_discovery_profiles": {"profile": profile()}, "user_interests": [],
                     "user_notification_settings": ALL_ON, "user_radar_alerts": []}
        self.inserts = []

    def as_user(self, token):
        self.token = token
        return self

    async def select(self, table, *, columns, filters, single=False, order=None, limit=None, offset=0):
        if table != "events":
            assert filters.get("id" if table == "profiles" else "user_id") == "eq.user"
        rows = self.rows[table]
        return rows if single or limit is None else rows[offset:offset + limit]

    async def insert(self, table, rows, **options):
        assert options == dict(upsert=True, ignore_duplicates=True,
                               on_conflict="user_id,event_id,kind", returning="minimal")
        for row in rows:
            assert row["user_id"] == "user"
            self.rows[table].append({**row, "created_at": NOW.isoformat()})
        self.inserts.extend(rows)


class DashboardTests(unittest.IsolatedAsyncioTestCase):
    async def test_digest_and_idempotence(self):
        db = FakeDatabase()
        candidates = {(str(i), "weekly_digest:2026-W23"): str(i) for i in range(5)}
        first = await dashboard_radar(db, "user", candidates, NOW)
        self.assertEqual(len(first), 3)
        self.assertEqual(await dashboard_radar(db, "user", candidates, NOW), first)
        self.assertEqual(len(db.inserts), 3)

    def test_route_scope_profile_and_opt_out(self):
        app = FastAPI()
        app.include_router(router, prefix="/v1")
        db = FakeDatabase()
        now = datetime.now(UTC)
        db.rows["events"] = [event(starts_at=(now + timedelta(days=1)).isoformat(),
                                   first_seen_at=now.isoformat(), last_verified_at=now.isoformat())]
        app.dependency_overrides[get_current_user] = lambda: {"id": "user", "access_token": "token"}
        app.dependency_overrides[get_anon_db] = lambda: db
        with TestClient(app) as client:
            response = client.get("/v1/me/picks")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(set(data), {"items", "radar", "profile"})
            self.assertEqual(data["radar"], [])
            self.assertFalse(db.inserts)
            db.rows["user_radar_alerts"] = [{"event_id": "1", "kind": "great_match",
                "created_at": now.isoformat(), "events": db.rows["events"][0]}]
            self.assertEqual(client.get("/v1/me/picks").json()["radar"][0]["kind"], "great_match")
            self.assertFalse(db.inserts)
            self.assertEqual(data["profile"]["notifications"], ALL_ON)
            self.assertEqual(db.token, "token")
            db.rows["user_notification_settings"] = None
            self.assertEqual(client.get("/v1/me/picks").json()["radar"], [])
            db.rows["user_discovery_profiles"] = None
            self.assertIsNone(client.get("/v1/me/picks").json()["profile"])
