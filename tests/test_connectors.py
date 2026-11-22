import asyncio
import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from workers.connectors import BRAVE_URL, collect_reviews, discover, VerificationFailure
from workers.connectors.fetch import Fetcher, checked_url, public_address, robots_rules
from workers.usage import measure_requests

HOST = "events.example.org"
URL = f"https://{HOST}/concert"
ROW = dict(slug="concerts", enabled=True, permission="publisher syndication", url=URL,
           allowed_hosts=[HOST], config={})
EVENT = {"@type": "MusicEvent", "name": "Trio", "url": URL,
         "startDate": "2027-03-11T19:30:00+01:00", "location": {"name": "Hall"},
         "image": "https://elsewhere.example/photo", "datePublished": "2027-01-01T02:00:00Z"}


class Connectors(unittest.TestCase):
    def run_source(self, kind, body, *, limit=50, **kwargs):
        source = {**ROW, "kind": kind, **kwargs}
        with patch.object(Fetcher, "get", new=AsyncMock(return_value=(URL, body))) as fetch, \
                patch("workers.connectors.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 11, 22, tzinfo=timezone.utc)
            result = asyncio.run(discover(source, limit=limit))
        return result, fetch

    def test_jsonld(self):
        body = ('<script type="application/ld+json">' + json.dumps({"@graph": [
            {**EVENT, "startDate": "2027-05-01"}, EVENT]}) + '</script>').encode()
        events, _ = self.run_source("jsonld", body)
        self.assertEqual([e.title for e in events], ["Trio"])
        self.assertEqual(events[0].venue_name, "Hall")
        # Artwork hosted somewhere the source is not authorised for is ignored.
        self.assertIsNone(events[0].image_url)
        self.assertTrue(events[0].raw["source_published_at"].startswith("2027-01-01"))

    def test_jsonld_artwork(self):
        """The publisher's own event image is kept; its site furniture is not."""
        poster = f"https://{HOST}/storage/events/abc.jpg"
        cases = [
            (poster, poster),                                   # plain string
            ([f"https://{HOST}/og-image.png", poster], poster),  # default share card skipped
            ({"@type": "ImageObject", "url": poster,
              "license": "https://creativecommons.org/publicdomain/zero/1.0/"}, poster),
            (f"https://{HOST}/images/site-logo.png", None),      # logo only
            ("https://elsewhere.example/photo.jpg", None),       # off-host
        ]
        for image, expected in cases:
            with self.subTest(image=image):
                body = ('<script type="application/ld+json">'
                        + json.dumps({**EVENT, "image": image}) + "</script>").encode()
                events, _ = self.run_source("jsonld", body)
                self.assertEqual(events[0].image_url, expected)

        licensed = ('<script type="application/ld+json">' + json.dumps({**EVENT, "image": {
            "url": poster, "license": "https://creativecommons.org/publicdomain/zero/1.0/",
        }}) + "</script>").encode()
        events, _ = self.run_source("jsonld", licensed)
        self.assertEqual(events[0].raw["image_license"],
                         "https://creativecommons.org/publicdomain/zero/1.0/")

    def test_ical(self):
        body = (f"BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:123\nSUMMARY:Trio\n"
                f"DTSTART;TZID=Europe/London:20270701T193000\nURL:{URL}\n"
                "STATUS:CANCELLED\nLOCATION:Great\\, Hall\nEND:VEVENT\nEND:VCALENDAR").encode()
        events, _ = self.run_source("ical", body)
        self.assertEqual(events[0].starts_at.isoformat(), "2027-07-01T19:30:00+01:00")
        self.assertEqual(events[0].status, "cancelled")
        self.assertEqual(events[0].venue_name, "Great, Hall")
        with collect_reviews() as reviews, self.assertRaises(VerificationFailure):
            self.run_source("ical", body.replace(b";TZID=Europe/London", b""))
        self.assertEqual(reviews[0]["external_id"], "123")
        self.assertEqual(reviews[0]["reason"], "unknown_start_or_timezone")
        self.assertEqual(reviews[0]["listing"]["url"], URL)

    def test_ical_covers_come_from_the_event_page(self):
        """A calendar feed has no image, so the event's own page supplies one."""
        feed = (f"BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:cover1\nSUMMARY:Trio\n"
                f"DTSTART:20270701T193000Z\nURL:{URL}\nEND:VEVENT\nEND:VCALENDAR").encode()
        poster = f"https://{HOST}/storage/events/poster.jpg"
        detail = ('<script type="application/ld+json">' + json.dumps(
            {**EVENT, "image": poster}) + "</script>").encode()

        async def answer(self, link, **kwargs):
            return (link, detail if link == URL else feed)

        source = {**ROW, "kind": "ical", "url": f"https://{HOST}/feed.ics",
                  "config": {"detail_images": True}}
        with patch.object(Fetcher, "get", new=answer):
            events = asyncio.run(discover(source, limit=10))
        self.assertEqual(events[0].image_url, poster)

        # Without the opt-in the page is never fetched, and nothing breaks.
        with patch.object(Fetcher, "get", new=answer):
            plain = asyncio.run(discover({**source, "config": {}}, limit=10))
        self.assertIsNone(plain[0].image_url)

        # An event whose cover is already stored is left alone, so a run's page
        # budget always reaches events that still need one.
        visited = []

        async def record(self, link, **kwargs):
            visited.append(link)
            return (link, detail if link == URL else feed)

        with patch.object(Fetcher, "get", new=record):
            asyncio.run(discover({**source, "covered_images": {"cover1"}}, limit=10))
        self.assertEqual(visited, [f"https://{HOST}/feed.ics"])

    def test_city_scoped_syndication(self):
        body = (f"BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:venue123\nSUMMARY:Trio\n"
                f"DTSTART:20270701T193000Z\nURL:{URL}\nEND:VEVENT\nEND:VCALENDAR").encode()
        events, _ = self.run_source("ical", body, config={"listing_only": True, "city": "Zurich"})
        self.assertIsNone(events[0].city)
        self.assertIsNone(events[0].venue_name)
        self.assertIs(events[0].raw["listing_only"], True)
        for location, expected in [("Hall\\, 8001 Zürich", "Zurich"), ("Hall\\, Winterthur", None),
                                   ("Zurich Insurance HQ\\, Kloten", None)]:
            with self.subTest(location=location):
                supplied = body.replace(b"END:VEVENT", f"LOCATION:{location}\nEND:VEVENT".encode())
                event, = self.run_source("ical", supplied, config={"city": "Zurich"})[0]
                self.assertEqual(event.city, expected)

    def test_ical_session_diversity_precedes_chronological_fill(self):
        def session(uid, date, title="Class", venue="Hall", status="CONFIRMED"):
            return (f"BEGIN:VEVENT\nUID:{uid}\nSUMMARY:{title}\nLOCATION:{venue}\n"
                    f"DTSTART:{date}T193000Z\nURL:{URL}\nSTATUS:{status}\nEND:VEVENT")

        sessions = [session("past", "20010101"), session("third", "20990103"),
                    session("first", "20990101"), session("second", "20990102"),
                    session("other-venue", "20990104", venue="Studio"),
                    session("other-title", "20990105", title="Reading"),
                    session("cancel", "20990106", status="CANCELLED")]
        for ordered in (sessions, sessions[::-1]):
            feed = ("\n".join(["BEGIN:VCALENDAR", *ordered, "END:VCALENDAR"])).encode()
            events, _ = self.run_source("ical", feed, limit=5)
            self.assertEqual([e.external_id for e in events],
                             ["first", "second", "other-venue", "other-title", "cancel"])
            self.assertEqual(events[-1].status, "cancelled")
            self.assertEqual(len(self.run_source("ical", feed)[0]), 6)
            self.assertEqual([e.external_id for e in self.run_source("ical", feed, limit=1)[0]], ["cancel"])

        recurring = [session("series\nRECURRENCE-ID:20990101T193000Z", "20990101"),
                     session("series\nRECURRENCE-ID:20990102T193000Z", "20990102", title="Guest teacher"),
                     session("other", "20990103", title="Reading")]
        feed = "\n".join(["BEGIN:VCALENDAR", *recurring, "END:VCALENDAR"]).encode()
        self.assertEqual([e.external_id for e in self.run_source("ical", feed, limit=2)[0]],
                         ["series/20990101T193000Z", "other"])
        self.assertEqual([e.external_id for e in self.run_source("ical", feed)[0]],
                         ["series/20990101T193000Z", "series/20990102T193000Z", "other"])

    def test_rss_published_is_not_start(self):
        body = (f'<rss xmlns:ev="http://purl.org/rss/1.0/modules/event/"><channel><item>'
                f'<title>Trio</title><link>{URL}</link><pubDate>Thu, 11 Mar 2027 12:00:00 GMT</pubDate>'
                '<ev:startdate>2027-03-11T19:00:00Z</ev:startdate></item></channel></rss>').encode()
        self.assertEqual(self.run_source("rss", body)[0][0].starts_at.hour, 19)
        with self.assertRaises(VerificationFailure):
            self.run_source("rss", body.replace(b"ev:startdate", b"unknown"))

    def test_unusable_detail_has_a_clear_failure(self):
        with collect_reviews() as reviews, self.assertRaises(VerificationFailure):
            self.run_source("jsonld", b"<html><title>site home</title></html>")
        self.assertEqual(reviews[0]["reason"], "missing_event_evidence")

    def test_rss_detail_resolves_missing_start_without_review(self):
        feed = f"<rss><channel><item><link>{URL}</link><title>Trio</title></item></channel></rss>"
        fetch = AsyncMock(side_effect=[(URL, feed.encode()), (URL, json.dumps(EVENT).encode())])
        with collect_reviews() as reviews, patch.object(Fetcher, "get", fetch):
            events = asyncio.run(discover({**ROW, "kind":"rss", "config":{"page_fallback":True}}))
        self.assertEqual([e.title for e in events], ["Trio"])
        self.assertEqual(reviews, [])

    def test_mixed_events_return_partial_success_and_scoped_reviews(self):
        body = json.dumps([EVENT, {**EVENT, "identifier":"bad", "startDate":"2027"}]).encode()
        with collect_reviews() as reviews:
            events, _ = self.run_source("jsonld", body)
        self.assertEqual(len(events), 1)
        self.assertEqual([r["external_id"] for r in reviews], ["bad"])
        self.assertEqual(reviews[0]["listing"]["title"], "Trio")
        self.assertEqual(reviews[0]["listing"]["reported_start"], "2027")

    def test_page_fallback_reads_scoped_event_microdata(self):
        body = b'<div itemscope itemtype="https://schema.org/Event"><meta itemprop="name" content="Trio"><time itemprop="startDate" datetime="2027-05-01T19:30:00Z"></time><div itemprop="location" itemscope itemtype="https://schema.org/Place"><span itemprop="name">Great Hall</span></div></div>'
        event, = self.run_source("jsonld", body, config={"page_fallback": True})[0]
        self.assertEqual((event.title, event.venue_name), ("Trio", "Great Hall"))

    def test_permission_gate(self):
        for updates in ({"enabled": False}, {"permission": ""}):
            events, fetch = self.run_source("jsonld", b"", **updates)
            self.assertFalse(events)
            fetch.assert_not_called()

    def test_search_facts_come_from_authorised_page(self):
        source = {**ROW, "kind":"search", "url":BRAVE_URL, "config":{"query":"concert"},
                  "allowed_hosts":["api.search.brave.com", HOST]}
        search = {"web":{"results":[{"url":"https://other.test/event"}, {"url":URL, "title":"wrong"}]}}
        fetch = AsyncMock(side_effect=[(BRAVE_URL, json.dumps(search).encode()),
                                       (URL, json.dumps(EVENT).encode())])
        with patch.dict(os.environ, BRAVE_SEARCH_API_KEY="fixture"), patch.object(Fetcher, "get", fetch):
            events = asyncio.run(discover(source))
        self.assertEqual([e.title for e in events], ["Trio"])
        self.assertEqual(fetch.await_count, 2)
        self.assertTrue(fetch.await_args_list[0].kwargs["api"])
        self.assertEqual(fetch.await_args_list[1].args, (URL,))

    def test_ticketmaster_does_not_manufacture_time_or_city(self):
        from core.config import settings
        from workers.sources.ticketmaster import API_URL
        source = {**ROW, "kind":"ticketmaster", "url":API_URL, "config":{"city":"London"},
                  "allowed_hosts":["app.ticketmaster.com", HOST]}
        raw = {"name":"Trio","id":"abc","url":URL,"dates":{"status":{"code":"onsale"},
               "start":{"localDate":"2027-03-11"},"timezone":"Europe/London"}}
        def fixture(records):
            return AsyncMock(return_value=(API_URL, json.dumps({"_embedded":{"events":records}}).encode()))
        with patch.object(settings, "ticketmaster_api_key", "fixture"):
            with patch.object(Fetcher, "get", fixture([raw])), collect_reviews() as reviews:
                with self.assertRaises(VerificationFailure):
                    asyncio.run(discover(source))
                self.assertEqual(reviews[0]["external_id"], "abc")
            raw["dates"]["start"]["localTime"] = "19:00:00"
            with patch.object(Fetcher, "get", fixture([raw])) as fetch:
                event, = asyncio.run(discover(source))
                self.assertEqual(event.starts_at.hour, 19)
                self.assertIsNone(event.city)
                self.assertTrue(fetch.await_args.kwargs["api"])

    def test_metering_counts_wire_attempts_and_pins_tls(self):
        observed = []

        class Client:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def handle_async_request(self, request):
                url = request.url
                observed.append((url.host, request.headers["Host"], request.extensions["sni_hostname"]))
                if url.path == "/robots.txt":
                    return httpx.Response(404)
                elif url.path == "/concert":
                    return httpx.Response(302, headers={"Location":"/redirected"})
                elif url.path == "/error":
                    raise httpx.ConnectError("fixture")
                else:
                    return httpx.Response(200, stream=httpx.ByteStream(b"ok"))

        async def run():
            dns = AsyncMock(return_value=[(0,0,0,"",("8.8.8.8",443))])
            with patch.object(asyncio.get_running_loop(), "getaddrinfo", dns), \
                 patch("workers.connectors.fetch.pace", AsyncMock()), \
                 patch("workers.connectors.fetch.httpx.AsyncHTTPTransport", Client), measure_requests() as usage:
                fetcher = Fetcher([HOST])
                self.assertEqual((await fetcher.get(URL))[1], b"ok")
                await fetcher.get(URL + "/api", api=True)
                with self.assertRaises(httpx.ConnectError):
                    await fetcher.get(f"https://{HOST}/error", api=True)
                dns.return_value = [(0,0,0,"",("127.0.0.1",443))]
                with self.assertRaises(ValueError):
                    await fetcher.get(URL, api=True)
                self.assertEqual((usage.requests, usage.billable_requests), (5, 2))
            self.assertEqual(observed, [("8.8.8.8", HOST, HOST)] * 5)
        asyncio.run(run())

    def test_public_transport(self):
        for url in ["http://events.example.org/", URL + "\n", "https://x@" + HOST,
                    "https://events.example.org.evil.com/", "https://events.example.org:444/"]:
            with self.assertRaises(ValueError):
                checked_url(url, {HOST})
        for address in ["127.0.0.1", "::ffff:127.0.0.1", "224.0.0.1", "169.254.169.254"]:
            self.assertFalse(public_address(address))
        rules = robots_rules(b"User-agent: *\nDisallow: /private*\nAllow: /private/open$\n")
        self.assertFalse(rules("/private/a")[0])
        self.assertTrue(rules("/private/open")[0])

    def test_robots_evaluates_the_wire_path(self):
        async def run():
            responses = AsyncMock(side_effect=[
                (200, {}, b"User-agent: *\nDisallow: /private\n"), (200, {}, b"unexpected")])
            with patch.object(Fetcher, "_request", responses), self.assertRaisesRegex(ValueError, "robots"):
                await Fetcher([HOST]).get(f"https://{HOST}/allowed/../private")
            self.assertEqual(responses.await_count, 1)
        asyncio.run(run())
