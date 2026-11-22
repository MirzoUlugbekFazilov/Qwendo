from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

from workers.radar import delivery_due, refresh, update_alerts


class RadarDeliveryTests(TestCase):
    def test_overnight_quiet_hours_in_local_time(self):
        now = datetime(2026,7,1,21,tzinfo=UTC)
        prefs = dict(quiet_start="22:00", quiet_end="07:00", timezone="Europe/London")
        self.assertFalse(delivery_due(prefs, now))
        self.assertTrue(delivery_due(prefs, now + timedelta(hours=9)))

    def test_daily_frequency(self):
        now = datetime(2026,1,2,tzinfo=UTC)
        self.assertFalse(delivery_due({"frequency":"daily"}, now, now - timedelta(hours=3)))
        self.assertTrue(delivery_due({"frequency":"daily"}, now, now - timedelta(days=1)))

    def test_verified_meaningful_change_only(self):
        now = datetime(2026,1,1,tzinfo=UTC)
        event = dict(id="e",verification_status="verified",title="Jazz trio",
                     last_verified_at=now.isoformat(), meaningful_updated_at=now.isoformat())
        item = dict(id="e", exploratory=False)
        alerts = update_alerts([item], [event], {"alerts":True}, now)
        self.assertEqual(len(alerts), 1)
        for overrides in ({"meaningful_updated_at":None},{"verification_status":"pending_review"}):
            self.assertFalse(update_alerts([item],[{**event,**overrides}],{"alerts":True},now))


class ScheduledDeliveryTests(IsolatedAsyncioTestCase):
    async def test_quiet_subscriber_never_materialises_candidates(self):
        db = AsyncMock()
        subscriber = dict(user_id="uid", alerts=True, digest=False, tickets=False)
        prefs = dict(frequency="daily",quiet_start="22:00",quiet_end="07:00",timezone="Europe/London")
        async def select(table, **kwargs):
            if table == "user_discovery_profiles":
                return {"profile":{"radar_preferences":prefs}}
            return []
        db.select.side_effect = select
        with patch("workers.radar.pages", new=AsyncMock(side_effect=[[subscriber],[]])), \
             patch("workers.radar.load_candidates",new=AsyncMock()) as load:
            self.assertEqual(await refresh(db,datetime(2026,7,1,21,tzinfo=UTC)),1)
        load.assert_not_awaited()
        db.insert.assert_not_awaited()
