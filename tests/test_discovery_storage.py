import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api.deps import get_current_user
from api.main import app


class DiscoveryStorageTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.db = AsyncMock()
        self.enterContext(patch("api.routers.discovery.account_db", return_value=self.db))
        self.enterContext(patch.dict(app.dependency_overrides, {
            get_current_user: lambda: {"id": "account", "access_token": "token"},
        }))

    def test_draft_never_marks_onboarded(self):
        r = self.client.put("/v1/me/discovery/draft", json={"step": 2, "profile": {}})
        self.assertEqual(r.status_code, 200)
        table, row = self.db.insert.await_args.args
        self.assertEqual((table, row["user_id"], row["step"]), ("user_discovery_drafts", "account", 2))
        self.db.rpc.assert_not_awaited()

    def test_confirmation_is_single_rpc_and_consent_defaults_off(self):
        r = self.client.put("/v1/me/discovery", json={"city": "London", "categories": ["tech"]})
        self.assertEqual(r.status_code, 200)
        name, args = self.db.rpc.await_args.args
        self.assertEqual(name, "confirm_discovery_profile")
        self.assertFalse(any(args["p_profile"]["notifications"].values()))
        self.assertIn("no-store", r.headers["cache-control"])

    def test_invalid_confirmation_does_not_touch_database(self):
        topic = {"name": "Jazz", "type": "topic", "source": "inferred", "confidence": 0.6, "priority":"must"}
        for body in [{}, {"city":"London","categories":["tech"],"interests":[topic]},
                     {"city":"London","categories":["tech"],"user_id":"somebody-else"}]:
            self.assertEqual(self.client.put("/v1/me/discovery", json=body).status_code, 422)
        self.db.rpc.assert_not_awaited()

    def test_edits_load_separate_opt_ins(self):
        self.db.select.side_effect = [{"profile": {"city":"York"}}, None, {"tickets": True,"alerts":False,"digest":False}]
        data = self.client.get("/v1/me/discovery").json()
        self.assertTrue(data["profile"]["notifications"]["tickets"])
        self.assertIsNone(data["draft"])
        self.assertTrue(all(call.kwargs["filters"] == {"user_id":"eq.account"} for call in self.db.select.await_args_list))

    def test_radar_preferences_validate_on_draft_and_confirmation(self):
        valid = {"frequency": "weekly", "quiet_start": "22:00", "quiet_end": "06:30",
                 "timezone": "Europe/Zurich"}
        profile = {"city": "Zurich", "categories": ["tech"], "radar_preferences": valid}
        self.assertEqual(self.client.put("/v1/me/discovery", json=profile).status_code, 200)
        self.assertEqual(self.db.rpc.await_args.args[1]["p_profile"]["radar_preferences"], valid)
        for change in [{"frequency": "hourly"}, {"timezone": "Never/Here"}, {"timezone": "../UTC"},
                       {"quiet_end": None}, {"quiet_start": "24:00"}, {"quiet_start": "7:30"}]:
            invalid = {**profile, "radar_preferences": {**valid, **change}}
            self.assertEqual(self.client.put("/v1/me/discovery", json=invalid).status_code, 422)
            self.assertEqual(self.client.put("/v1/me/discovery/draft",
                                             json={"step": 6, "profile": invalid}).status_code, 422)
