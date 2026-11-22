from datetime import UTC, datetime
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from core.models import NormalizedEvent
from workers.discovery_jobs import event_row, gap_pairs, drain, execute, schedule
from workers.usage import count_request


class DiscoveryJobTests(IsolatedAsyncioTestCase):
    def test_only_reviewed_values_reach_search(self):
        taxonomy = [dict(slug="jazz", label="Jazz", keywords=["bebop"], category="music")]
        profile = dict(city="lOnDoN", text="private text", interests=[
            dict(name="bebop", confirmed=True), dict(name="private text", confirmed=True)])
        self.assertEqual(gap_pairs([profile]*3, taxonomy, ["London"], []), [("London","jazz","Jazz")])
        self.assertEqual(gap_pairs([profile], taxonomy, ["London"], []), [("London","jazz","Jazz")])
        self.assertFalse(gap_pairs([profile]*3, taxonomy, ["Oxford"], []))
        self.assertFalse(gap_pairs([profile]*3, taxonomy, ["London"], [dict(city="London",title="Bebop night")]))

    def test_retry_preserves_first_seen_and_distinguishes_publication(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        event = NormalizedEvent(source="gallery", external_id="exhibit", url="https://example.org/e",
                                title="Exhibition", starts_at=now, status="cancelled")
        row = event_row(event, now)
        self.assertNotIn("first_seen_at", row)
        self.assertNotIn("embedding", row)
        self.assertNotIn("source_published_at", row)
        self.assertEqual(row["last_verified_at"], now.isoformat())
        self.assertEqual(row["official_url"], event.url)
        self.assertEqual(row["verification_status"], "cancelled")
        syndicated = event.model_copy(update={"raw":{"listing_only":True}})
        listing = event_row(syndicated, now)
        self.assertEqual(listing["url"], event.url)
        self.assertIsNone(listing["official_url"])

    def test_operator_dictionary_classifies_at_ingestion(self):
        now = datetime.now(UTC)
        event = NormalizedEvent(source="s",external_id="1",url="https://s.org/1",
                                title="Bebop trio",starts_at=now)
        row = event_row(event, now, [dict(slug="jazz",label="Jazz",keywords=["bebop"],category="music")])
        self.assertIn("jazz", row["tags"])
        self.assertIn("music", row["categories"])

    async def test_failure_is_reported_with_lease_without_logging_sensitive_error(self):
        db = AsyncMock()
        job = {"id":"1", "lease_token":"lease", "kind":"refresh", "source_slug":"s", "payload":{}, "attempts":1}
        db.rpc.side_effect = [[job], True, []]
        db.select.return_value = {"slug":"s","kind":"rss","permission":"licensed","enabled":True,"allowed_hosts":["s.org"]}
        db.insert.return_value = [{"id":9}]
        async def discover(*args, **kwargs):
            count_request(True)
            count_request(False)
            raise ValueError("private token")
        self.assertEqual(await drain(db, discover=discover), 1)
        finish = db.rpc.await_args_list[1]
        self.assertEqual(finish.args, ("discovery_fail", {
            "p_id":"1","p_token":"lease","p_error":"ValueError","p_retry_seconds":60}))
        usage = next(call for call in db.insert.await_args_list if call.args[0]=="discovery_usage")
        self.assertEqual(usage.kwargs["on_conflict"], "job_id,attempt")
        self.assertEqual(usage.args[1]["requests"], 2)
        self.assertEqual(usage.args[1]["billable_requests"], 1)

    async def test_due_search_without_static_query_schedules_a_plan(self):
        now = datetime.now(UTC)
        db = AsyncMock()
        db.select.side_effect = [[
            dict(slug="s",kind="search",config={},last_success_at=None,interval_minutes=60),
            dict(slug="current",kind="rss",config={},last_success_at=now.isoformat(),interval_minutes=60)
        ], []]
        await schedule(db,now)
        self.assertEqual(db.rpc.await_count,1)
        self.assertEqual(db.rpc.await_args.args[1]["p_kind"], "gap_scan")

    async def test_reviewed_submission_persists_metered_fenced_observation(self):
        db = AsyncMock()
        submitted = "https://s.org/new"
        source = dict(slug="s",kind="jsonld",url="https://s.org/default",enabled=True,
                      permission="licensed",allowed_hosts=["s.org"],config={"cost_per_request_gbp":"0.03"})
        db.select.side_effect = [source, []]
        db.insert.return_value = [{"id":13}]
        db.rpc.return_value = {"outcome":"stored"}
        async def discover(row, *, limit):
            self.assertEqual(row["url"],submitted)
            count_request(True)
            return [NormalizedEvent(source="s",url=submitted,title="Exhibition",external_id="x",
                                    starts_at=datetime.now(UTC))]
        await execute(db,dict(id="j",source_slug="s",attempts=2,lease_token="l",kind="verify_url",
                              payload={"url":submitted}),discover)
        rpc, observation = db.rpc.await_args.args
        self.assertEqual(rpc,"discovery_persist")
        self.assertEqual(observation["p_job_id"],"j")
        self.assertEqual(observation["p_token"],"l")
        self.assertEqual(observation["p_evidence"]["verification_status"],"verified")
        self.assertEqual(db.insert.await_args.args[1]["estimated_cost_gbp"],"0.03")

    async def test_gap_request_uses_current_dictionary_label_and_city(self):
        db = AsyncMock()
        source = dict(slug="search",kind="search",enabled=True,permission="API",
                      allowed_hosts=["api.search.brave.com"],config={"cities":["London"]})
        profile = dict(city="london",categories=[],interests=[
            dict(name="bebop",source="explicit",source_text="private details")])
        taxonomy = [dict(slug="jazz",label="Jazz concerts",category="music",keywords=["bebop"])]
        db.select.side_effect = [source, [profile], taxonomy, []]
        db.insert.return_value = [{"id":8}]
        discover = AsyncMock(return_value=[])
        job = dict(id="j",attempts=1,source_slug="search",lease_token="token",kind="interest_gap",
                   payload={"slug":"jazz","city":"London","query":"injected free text"})
        await execute(db,job,discover)
        self.assertEqual(discover.await_args.args[0]["config"]["query"],"Jazz concerts events in London")
        db.select.side_effect = [source, [], taxonomy, []]
        await execute(db,job,discover)
        discover.assert_awaited_once()
