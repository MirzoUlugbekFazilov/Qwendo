import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from api.routers.events import list_events


class EventSearch(unittest.IsolatedAsyncioTestCase):
    async def query(self, q, **options):
        db = AsyncMock()
        db.select.return_value = []
        await list_events(db, q=q, **options)
        return db.select.await_args.kwargs

    async def test_format_typos_and_plurals_have_the_same_filters(self):
        for term in ("hakcathons", "Hackathon", "hackathons", "Hackathon events"):
            with self.subTest(term=term):
                filters = (await self.query(term))["filters"]
                self.assertEqual(filters["search_tsv"], "wfts(english).hackathon")
                self.assertIn("search_tsv.fts(english).hackathon:A", filters["and"])
                self.assertIn('tags.ov."{hackathon,hackathons}"', filters["and"])

    async def test_multiword_search_keeps_qualifiers_and_pagination(self):
        options = await self.query("Ada Lovelace", limit=4)
        self.assertEqual(options["filters"]["search_tsv"], "wfts(english).Ada Lovelace")
        options = await self.query("AI workhsops", city="London", free_only=True,
                                   starts_before=datetime(2090, 1, 1, tzinfo=UTC), offset=24)
        filters = options["filters"]
        self.assertEqual(filters["search_tsv"], "wfts(english).AI workshop")
        self.assertIn("workshop:A", filters["and"])
        self.assertIn("starts_at.lte.", filters["and"])
        self.assertIn("London", filters["or"])
        self.assertEqual(filters["is_free"], "eq.true")
        self.assertEqual(options["offset"], 24)

    async def test_websearch_operators_keep_their_meaning(self):
        for term in ('"concert events"', "workshop OR concert", "jazz -concert"):
            filters = (await self.query(term))["filters"]
            self.assertEqual(filters["search_tsv"], f"wfts(english).{term}")
            self.assertNotIn("and", filters)
