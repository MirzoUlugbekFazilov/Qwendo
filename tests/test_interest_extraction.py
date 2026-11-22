import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import get_current_user
from api.routers import interest_extraction as extraction


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(extraction.router, prefix="/v1")
        self.app = app
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.actor = "alice"
        app.dependency_overrides[get_current_user] = lambda: {"id": self.actor}
        extraction._cache.clear()
        extraction._windows.clear()

    def post(self, text="I like F1 and glass blowing", categories=None):
        return self.client.post("/v1/me/discovery/extract", json={
            "text": text, "categories": ["sports"] if categories is None else categories,
        })

    def test_requires_authentication(self):
        self.app.dependency_overrides.clear()
        self.assertEqual(self.post().status_code, 401)

    def test_fallback_preserves_evidence_and_custom_names(self):
        response = self.post()
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(response.json()["mode"], "fallback")
        items = response.json()["interests"]
        self.assertEqual([x["name"] for x in items], ["Formula 1", "glass blowing"])
        self.assertEqual([x["source_text"] for x in items], ["F1", "glass blowing"])
        self.assertTrue(all(x["source"] == "explicit" for x in items))

    def test_validation(self):
        for text, categories in [(" ", []), ("x" * 5000, []), ("jazz", ["other"])]:
            self.assertEqual(self.post(text, categories).status_code, 422)

    def test_radar_preserves_both_qualified_interests(self):
        text = "I never want to miss Spider-Man cast appearances or startup networking events involving AI founders."
        response = self.post(text).json()
        self.assertEqual(response["mode"], "fallback")
        spans = ["Spider-Man cast appearances", "startup networking events involving AI founders"]
        self.assertEqual([(i["name"], i["source_text"], i["priority"]) for i in response["interests"]],
                         [(span, span, "must") for span in spans])

    def test_radar_does_not_override_negative_preferences(self):
        result = self.post("I never want to see opera or jazz, but I never want to miss F1. I like films.")
        self.assertEqual([(i["name"], i["priority"]) for i in result.json()["interests"]],
                         [("Formula 1", "must"), ("films", "curious")])

    def test_wizard_radar_placeholder(self):
        result = self.post("I’d hate to miss a Studio Ghibli retrospective in London.")
        self.assertEqual([i["source_text"] for i in result.json()["interests"]],
                         ["a Studio Ghibli retrospective in London"])

    def test_preserves_custom_name_starting_with_preference_verb(self):
        items = self.post("Lovelace Society, but I dislike jazz and opera").json()["interests"]
        self.assertEqual([i["name"] for i in items], ["Lovelace Society"])

    def test_extraction_has_no_network_dependency(self):
        with patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as upstream:
            first = self.post("I love jazz").json()
            self.actor = "bob"
            self.assertEqual(self.post("I love jazz").json(), first)
            self.assertEqual([i["name"] for i in first["interests"]], ["jazz"])
            upstream.assert_not_awaited()

    def test_rate_limit_applies_to_cached_requests(self):
        with patch.object(extraction, "_RATE_LIMIT", 2):
            self.assertEqual(self.post().status_code, 200)
            self.assertEqual(self.post().status_code, 200)
            response = self.post()
            self.assertEqual(response.status_code, 429)
            self.assertGreater(int(response.headers["retry-after"]), 0)
            self.actor = "bob"
            self.assertEqual(self.post().status_code, 200)
