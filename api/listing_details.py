"""Fill gaps in catalogue records from the public event detail page."""

import asyncio
import json
import re
from urllib.parse import urlsplit

import httpx
from selectolax.parser import HTMLParser

from core.text import make_summary, strip_html


def listing_fields(html: str, source: str) -> dict:
    page = HTMLParser(html)
    fields = {}
    for script in page.css('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.text())
        except ValueError:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if isinstance(node.get("@graph"), list):
                nodes.extend(node["@graph"])
            kind = node.get("@type")
            if not isinstance(kind, str) or not kind.endswith("Event"):
                continue
            organizer = node.get("organizer")
            if isinstance(organizer, dict) and isinstance(organizer.get("name"), str):
                fields["organizer"] = organizer["name"]
            if isinstance(node.get("description"), str):
                fields["description"] = strip_html(node["description"])
            break
    if not fields.get("description"):
        meta = page.css_first('meta[property="og:description"]')
        if meta and meta.attributes.get("content"):
            fields["description"] = strip_html(meta.attributes["content"])
    if source == "eventbrite":
        notes = [strip_html(p.text(separator=" ")) for p in page.css("p")
                 if re.search(r"\b(one pass|both days|two.day pass)\b", p.text(), re.I)]
        overview = fields.get("description", "")
        fields["description"] = "\n\n".join(dict.fromkeys([part for part in [overview, *notes] if part]))
    if fields.get("description"):
        fields["summary"] = make_summary(fields["description"])
    body = page.body
    if source == "luma" and body:
        for tag in body.css("script, style"):
            tag.decompose()
        visible = " ".join(body.text(separator=" ").lower().split())
        if "register to see address" in visible or "register to see the exact location" in visible:
            fields.update(venue_name="Address shared after registration", address=None, lat=None, lng=None)
    if not fields.get("description"):
        fields.pop("description", None)
    return fields


async def enrich_listing(event: dict) -> dict:
    source = event["source"]
    url = urlsplit(event["url"])
    if source == "luma" and url.hostname in {"lu.ma", "luma.com"}:
        target = "https://luma.com" + url.path
    elif source == "eventbrite" and url.hostname in {"www.eventbrite.co.uk", "www.eventbrite.com"}:
        target = "https://" + url.hostname + url.path
    else:
        return event
    if event.get("description") and event.get("address") and event.get("organizer") and event["organizer"].lower() != source:
        return event
    try:
        async with asyncio.timeout(3), httpx.AsyncClient() as client:
            async with client.stream("GET", target) as response:
                if response.status_code != 200:
                    return event
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 3_000_000:
                        return event
        return {**event, **listing_fields(content.decode("utf-8", errors="replace"), source)}
    except (httpx.HTTPError, TimeoutError):
        return event
