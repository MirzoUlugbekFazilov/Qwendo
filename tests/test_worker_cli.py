import io
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import AsyncMock, patch

from workers import run


class WorkerCliTests(unittest.TestCase):
    def setUp(self):
        self.db = AsyncMock()
        self.client = self.enterContext(patch("workers.run.service_client", return_value=self.db))
        self.output = self.enterContext(redirect_stdout(io.StringIO()))
        self.enterContext(redirect_stderr(io.StringIO()))

    def test_options_create_shared_durable_refresh_jobs(self):
        self.db.select.return_value = [
            dict(slug="tm",kind="ticketmaster",enabled=True,permission="API",allowed_hosts=["tm.example"]),
            dict(slug="feed",kind="ical",enabled=True,permission="feed",allowed_hosts=["feed.example"]),
        ]
        args = ["ingest","-s","tm","-s","feed","-c","London","-c","Leeds","-q","jazz","-n","12"]
        self.assertEqual(run.main(args), 0)
        jobs = [call.args[1] for call in self.db.rpc.call_args_list]
        self.assertEqual([j["p_payload"].get("city") for j in jobs], ["London","Leeds",None])
        self.assertTrue(all(j["p_kind"]=="refresh" and j["p_payload"]["limit"]==12 for j in jobs))
        self.assertEqual(jobs[0]["p_payload"]["query"], "jazz")
        self.assertNotEqual(jobs[0]["p_key"], jobs[1]["p_key"])
        self.db.aclose.assert_awaited_once()

    def test_validate_all_slugs_before_enqueue(self):
        self.db.select.return_value = [dict(slug="s",kind="rss",enabled=False,permission="",allowed_hosts=[])]
        self.assertEqual(run.main(["ingest","-s","missing","-s","s"]), 1)
        self.db.rpc.assert_not_awaited()

    def test_sources_read_only(self):
        self.db.select.return_value = [dict(slug="s",kind="rss",enabled=False,permission="",allowed_hosts=[])]
        self.assertEqual(run.main(["sources"]),0)
        self.assertIn("disabled", self.output.getvalue())
        self.db.rpc.assert_not_awaited()
        self.db.update.assert_not_awaited()

    def test_expire_preserves_cancellations(self):
        self.assertEqual(run.main(["expire"]),0)
        args, kwargs = self.db.update.await_args
        self.assertEqual(args, ("events", {"status":"expired"}))
        self.assertEqual(kwargs["filters"]["status"],"eq.active")
        self.assertTrue(kwargs["filters"]["starts_at"].startswith("lt."))

    def test_embed_prints_retirement_without_credentials(self):
        self.assertNotEqual(run.main(["embed","--limit","10"]),0)
        self.assertIn("retired", self.output.getvalue())
        self.client.assert_not_called()

    def test_links_reports_unapproved_destinations_offline(self):
        self.db.select.side_effect = [
            [dict(slug="s",kind="jsonld",enabled=True,permission="publisher",allowed_hosts=["s.example"])],
            [dict(url="https://elsewhere.example/events/1",title="Elsewhere")],
        ]
        self.assertEqual(run.main(["links","-s","s","-n","1"]),1)
        self.assertIn("invalid", self.output.getvalue())
        self.db.rpc.assert_not_awaited()

    def test_no_arguments_keeps_scheduler_entry_point(self):
        with patch.object(run.discovery_jobs,"main",new=AsyncMock(return_value=False)) as scheduler:
            self.assertEqual(run.main([]),0)
        scheduler.assert_awaited_once()
