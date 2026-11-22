from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

from api.discovery_ranking import rank_events
from core.taxonomy import infer_categories
from workers.radar import refresh


class DiscoveryBehaviour(TestCase):
    def test_shared_topic_different_motivations(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        events = [
            dict(id=title, source="luma", url="https://lu.ma/" + slug,
                 title="AI " + title, starts_at=(now+timedelta(days=1)).isoformat(),
                 verification_status="verified", last_verified_at=now.isoformat(), official_url="https://lu.ma/"+slug,
                 categories=["tech"], city="London", timezone="Europe/London", status="active")
            for title,slug in [("networking mixer","mix"),("workshop","learn")]
        ]
        def top(motivation):
            p = {"city":"London","categories":["tech"],"motivations":[motivation]}
            return rank_events(events,p,[],now)[0]["id"]
        self.assertEqual(top("Grow my professional network"),"networking mixer")
        self.assertEqual(top("Learn new things"),"workshop")

    def test_classification_requires_keyword_evidence(self):
        self.assertEqual(infer_categories("A programming workshop", seed=["tech"]), ["tech", "education"])
        self.assertEqual(infer_categories("A digital tourmaline collection"), [])


class RadarWorkerTests(IsolatedAsyncioTestCase):
    async def test_no_subscribers_never_reads_catalogue(self):
        with patch("workers.radar.pages", new=AsyncMock(return_value=[])) as read:
            self.assertEqual(await refresh(AsyncMock()),0)
        self.assertEqual(read.await_count,1)
        self.assertIn("digest.eq.true",read.await_args.args[3]["or"])
