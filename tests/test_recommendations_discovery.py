import unittest
from unittest.mock import AsyncMock, patch

from api.routers import recommendations as routes
from api.schemas import PreviewIn


def event(key, **values):
    return dict({
        "id": key, "title": key, "source": "luma", "url": f"https://lu.ma/{key}",
        "official_url": values.get("url", f"https://lu.ma/{key}"), "verification_status": "verified",
        "last_verified_at": "2020-01-01T00:00:00Z", "starts_at": "2090-01-01T12:00:00+00:00", "status": "active", "city": "London",
        "categories": ["music"], "is_free": True, "price_min": 0, "currency": "GBP",
    }, **values)


class DiscoveryRecommendations(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = {"id": "alice", "access_token": "alice-token"}
        self.profile = {"city": "London", "flexible_travel": True, "interests": [
            {"name": "Jazz", "source": "explicit", "priority": "must"},
        ]}
        self.events = [
            event("local"), event("travel", city="Paris"), event("wrong-category", categories=["tech"]),
            event("other-source", source="eventbrite", url="https://eventbrite.com/e/example"),
            event("expensive", price_min=100), event("far", lat=55, lng=0), event("ignored"), event("Jazz"),
        ]
        self.db = AsyncMock()
        self.db.select.side_effect = self.select
        self.account = self.enterContext(patch.object(routes, "account_db", return_value=self.db))

    async def select(self, table, *, columns, filters, **options):
        if table == "events":
            self.filters = filters
            return [e for e in self.events if "id" not in filters or filters["id"] == "eq." + e["id"]]
        if table == "profiles":
            self.assertEqual(filters, {"id": "eq.alice"})
            return {"lat": 51.5, "lng": -0.1, "city": "London"}
        self.assertEqual(filters, {"user_id": "eq.alice"})
        if table == "user_discovery_profiles":
            return {"profile": self.profile} if self.profile else None
        if table == "user_interests":
            return [{"interests": {"label": "Jazz", "category": "music", "keywords": []}}]
        self.assertEqual(table, "saved_events")
        return [{"state": "dismissed", "event_id": "ignored"}]

    async def test_filters_rank_and_dismiss_before_paging(self):
        from datetime import UTC, datetime

        params = dict(city="London", radius_km=10, free_only=True, max_price=20, categories=["music"],
                      sources=["luma"], starts_after=datetime(2089, 1, 1, tzinfo=UTC),
                      starts_before=datetime(2091, 1, 1, tzinfo=UTC), limit=1)
        for offset, expected in enumerate(["Jazz", "local", None]):
            result = await routes.recommendations(self.db, self.user, **params, offset=offset)
            self.assertEqual([r.id for r in result.items], [expected] if expected else [])
            self.assertTrue(result.personalized)
        self.assertEqual(self.filters["verification_status"], "eq.verified")
        self.assertEqual(self.filters["categories"], 'ov.{"music"}')
        self.assertEqual(self.filters["starts_at"], "gte.2089-01-01T00:00:00+00:00")
        self.db.insert.assert_not_awaited()
        self.db.rpc.assert_not_awaited()

    async def test_detail_uses_read_only_match_and_obeys_dismissal(self):
        match = await routes.relevance(self.user, "Jazz")
        self.assertEqual(match["matched_interest"], "Jazz")
        self.assertIsNone(await routes.relevance(self.user, "ignored"))
        self.assertEqual(self.filters["id"], "eq.ignored")
        self.db.insert.assert_not_awaited()
        self.db.rpc.assert_not_awaited()

    async def test_legacy_account_ranks_saved_interests(self):
        self.profile = None
        with patch.object(routes, "get_profile", AsyncMock(return_value={"city": "London"})):
            result = await routes.recommendations(self.db, self.user, limit=1)
        self.assertEqual(result.items[0].id, "Jazz")
        self.assertTrue(result.personalized)
        self.db.rpc.assert_not_awaited()

    async def test_public_preview_only_returns_verified_matches(self):
        db = AsyncMock()
        async def select(table, **kwargs):
            if table == "interests":
                return [{"label": "Jazz", "category": "music", "keywords": []}]
            self.assertLessEqual(kwargs["limit"], 300)
            return [event("Jazz"), event("Jazz secret", verification_status="pending_review")]
        db.select.side_effect = select
        response = await routes.preview(db, PreviewIn(interests=["music"]))
        self.assertEqual([item.id for item in response.items], ["Jazz"])
        self.assertTrue(response.personalized)
        self.account.assert_not_called()
        db.rpc.assert_not_awaited()

class CatalogueVisibility(unittest.IsolatedAsyncioTestCase):
    async def test_public_surfaces_return_only_verified_canonical_rows(self):
        from api.routers import events
        db = AsyncMock()
        rows = [event("live", url="https://publisher.example/events/live"),
                event("pending", verification_status="pending_review"),
                event("copy", canonical_event_id="live"), event("cancelled", status="cancelled")]
        rows[0]["url"] = "https://old.example/events/stale"
        db.select.return_value = rows
        db.rpc.return_value = rows
        for page in [await events.list_events(db, q="music events"), await events.hero(db),
                     await events.trending(db)]:
            self.assertEqual([item.id for item in page.items], ["live"])
            self.assertEqual(page.items[0].url, rows[0]["url"])
            self.assertEqual(page.items[0].official_url, rows[0]["official_url"])
        for call in db.select.await_args_list:
            self.assertEqual(call.kwargs["filters"]["canonical_event_id"], "is.null")
            self.assertEqual(call.kwargs["filters"]["verification_status"], "eq.verified")

    async def test_saved_and_dismissed_never_expose_pending_listings(self):
        from api.routers import me
        from api.schemas import SaveIn
        from fastapi import HTTPException
        from unittest.mock import Mock
        scoped = AsyncMock()
        scoped.select.return_value = [{"events": event("live")},
                                      {"events": event("secret", verification_status="rejected")}]
        user = {"id": "alice", "access_token": "token"}
        with patch.object(me, "get_anon_db", return_value=Mock(as_user=Mock(return_value=scoped))):
            result = await me.saved_events(user, state="dismissed")
            self.assertEqual([item.id for item in result.items], ["live"])
            scoped.select.return_value = event("secret", verification_status="pending_review")
            for state in ["saved", "going", "dismissed"]:
                with self.assertRaises(HTTPException) as error:
                    await me.save_event(user, "secret", SaveIn(state=state))
                self.assertEqual(error.exception.status_code, 404)
            scoped.insert.assert_not_awaited()
