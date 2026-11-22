"""Extract only event-specific publisher fields. Dates require explicit time and zone."""

import json
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from selectolax.parser import HTMLParser

from core.models import NormalizedEvent
from core.text import strip_html
from .fetch import checked_url
from .reviews import review


def instant(value, zone=None):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-?\d{2}-?\d{2}[T ]\d{2}:?\d{2}(?::?\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?", value
    ):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo:
            return dt
        if zone:
            first = dt.replace(tzinfo=ZoneInfo(zone))
            if first.utcoffset() == first.replace(fold=1).utcoffset():
                return first
    except (ValueError, ZoneInfoNotFoundError, TypeError):
        pass
    return None


def event(row, *, url, title, start, uid=None, published=None, reported_start=None, **fields):
    try:
        parsed = checked_url(url, row["allowed_hosts"])
        if not parsed.path.strip("/"):
            review(row, "missing_detail_url", url, title, uid)
            return None
        if not start:
            review(row, "unknown_start_or_timezone", url, title, uid, reported_start)
            return None
        if not isinstance(title, str) or not title.strip():
            review(row, "missing_title", url, title, uid)
            return None
        return NormalizedEvent(source=row["slug"], url=url, external_id=str(uid or url),
                               title=strip_html(title), starts_at=start,
                               timezone=str(start.tzinfo), raw={
                                   "source_published_at": published.isoformat() if published else None,
                               }, **fields)
    except (ValueError, TypeError):
        review(row, "invalid_publisher_fields", url, title, uid)
        return None


def mapping(value):
    return value if isinstance(value, dict) else {}


EVENT_TYPES = set("""Event BusinessEvent ChildrensEvent ComedyEvent CourseInstance DanceEvent
DeliveryEvent EducationEvent EventSeries ExhibitionEvent Festival FoodEvent Hackathon LiteraryEvent
MusicEvent PublicationEvent SaleEvent ScreeningEvent SocialEvent SportsEvent TheaterEvent
VisualArtsEvent BroadcastEvent OnDemandEvent UserInteraction""".split())


def event_type(value):
    types = value if isinstance(value, list) else [value]
    return any(isinstance(t, str) and t.removeprefix("https://schema.org/").removeprefix(
        "http://schema.org/") in EVENT_TYPES for t in types)


def schema_event(node, row, page):
    place = mapping(node.get("location"))
    address = mapping(place.get("address"))
    status = str(node.get("eventStatus", "")).rsplit("/", 1)[-1]
    image = mapping(node.get("image"))
    image_url = None
    license_url = image.get("license")
    if isinstance(license_url, str) and re.fullmatch(
        r"https://creativecommons\.org/publicdomain/(?:zero/1\.0|mark/1\.0)/?", license_url
    ):
        try:
            candidate = image.get("contentUrl") or image.get("url")
            checked_url(candidate, row["allowed_hosts"])
            image_url = candidate
        except ValueError:
            pass
    result = event(row, url=node.get("url") or page, title=node.get("name"),
                   start=instant(node.get("startDate")), reported_start=node.get("startDate"),
                   uid=node.get("identifier")
                   if isinstance(node.get("identifier"), (str, int)) else None,
                   ends_at=instant(node.get("endDate")), published=instant(node.get("datePublished")),
                   venue_name=place.get("name"), city=address.get("addressLocality"),
                   address=address.get("streetAddress"), image_url=image_url,
                   organizer=mapping(node.get("organizer")).get("name"),
                   description=strip_html(node.get("description")) if isinstance(node.get("description"), str) else None,
                   is_online=str(node.get("eventAttendanceMode", "")).endswith("/OnlineEventAttendanceMode"),
                   status={"EventCancelled": "cancelled", "EventPostponed": "postponed"}.get(status, "active"))
    if result and image_url:
        result.raw["image_license"] = license_url
    return result


def microdata(scope, depth=0):
    node = {}
    for child in scope.css("[itemprop]"):
        ancestor = child.parent
        while ancestor and "itemscope" not in ancestor.attributes:
            ancestor = ancestor.parent
        if ancestor is None or ancestor.mem_id != scope.mem_id:
            continue
        attrs = child.attributes
        if "itemscope" in attrs:
            if depth < 2:
                node[attrs["itemprop"]] = microdata(child, depth + 1)
        else:
            node[attrs["itemprop"]] = (attrs.get("datetime") or attrs.get("content")
                                       or attrs.get("href") or child.text(strip=True))
    return node


def jsonld(body, row, page):
    tree = HTMLParser(body)
    documents = [s.text() for s in tree.css('script[type="application/ld+json"]')]
    if body.lstrip().startswith((b"{", b"[")):
        documents = [body]
    for document in documents:
        try:
            stack = [json.loads(document)]
        except (ValueError, RecursionError):
            continue
        nodes = []
        while stack:
            obj = stack.pop()
            if isinstance(obj, list):
                stack.extend(reversed(obj))
            elif isinstance(obj, dict):
                if event_type(obj.get("@type")):
                    nodes.append(obj)
                stack.extend(reversed([v for v in obj.values() if isinstance(v, (dict, list))]))
        for node in nodes:
            yield schema_event(node, row, page if len(nodes) == 1 and len(documents) == 1 else None)
    if row.get("config", {}).get("page_fallback") is True:
        scopes = [s for s in tree.css("[itemscope][itemtype]") if event_type(s.attributes["itemtype"])]
        for scope in scopes:
            yield schema_event(microdata(scope), row, page if len(scopes) == 1 else None)


def rss(body, row):
    if b"<!DOCTYPE" in body.upper() or b"\0" in body:
        raise ValueError("Unsupported XML declaration or encoding")
    root = ElementTree.fromstring(body)
    if root.tag.split("}")[-1] not in {"rss", "RDF"}:
        raise ValueError("Expected RSS document")
    ns = "{http://purl.org/rss/1.0/modules/event/}"
    for item in root.findall(".//{*}item"):
        url = item.findtext("{*}link")
        start = instant(item.findtext(ns + "startdate"))
        if not start and row.get("config", {}).get("page_fallback") is True:
            try:
                detail = checked_url(url, row["allowed_hosts"])
            except ValueError:
                detail = None
            if detail and detail.path.strip("/"):
                yield url, None
                continue
        published = item.findtext("pubDate")
        try:
            published = parsedate_to_datetime(published) if published else None
        except (TypeError, ValueError, OverflowError):
            published = None
        yield url, event(row, url=url, uid=item.findtext("guid"), title=item.findtext("{*}title"),
                         start=start,
                         reported_start=item.findtext(ns + "startdate"),
                         ends_at=instant(item.findtext(ns + "enddate")),
                         venue_name=item.findtext(ns + "location"),
                         published=published if published and published.tzinfo else None)


def ical(body, row):
    lines = re.sub(r"\r?\n[ \t]", "", body.decode("utf-8-sig")).splitlines()
    if not lines or lines[0].upper() != "BEGIN:VCALENDAR":
        raise ValueError("Expected VCALENDAR")
    stack, fields = [], {}
    calendar_zone = None
    for line in lines:
        key, sep, value = line.partition(":")
        if not sep:
            continue
        name, *params = key.upper().split(";")
        if name == "BEGIN":
            stack.append(value.upper())
            if stack == ["VCALENDAR", "VEVENT"]:
                fields = {}
        elif name == "END":
            if not stack or stack[-1] != value.upper():
                raise ValueError("Unbalanced calendar components")
            if stack == ["VCALENDAR", "VEVENT"] and not ({"RRULE", "RDATE", "EXDATE"} & fields.keys()):
                def moment(prop):
                    val, tz = fields.get(prop, (None, None))
                    return instant(val, tz or calendar_zone)

                def value_for(prop):
                    return fields.get(prop, (None, None))[0]

                uid = value_for("UID")
                recurrence = value_for("RECURRENCE-ID")
                session = event(row, url=value_for("URL"), uid=f"{uid}/{recurrence}" if uid and recurrence else uid,
                            title=value_for("SUMMARY"), start=moment("DTSTART"), ends_at=moment("DTEND"),
                            reported_start=value_for("DTSTART"),
                            published=moment("CREATED"), venue_name=value_for("LOCATION"),
                            status="cancelled" if value_for("STATUS") == "CANCELLED" else "active")
                if session and uid and recurrence:
                    session.raw["ical_series_uid"] = uid
                yield session
            elif stack == ["VCALENDAR", "VEVENT"]:
                review(row, "unexpanded_recurrence", fields.get("URL", (None,))[0],
                       fields.get("SUMMARY", (None,))[0], fields.get("UID", (None,))[0])
            stack.pop()
        elif stack == ["VCALENDAR"] and name == "X-WR-TIMEZONE":
            calendar_zone = value
        elif stack == ["VCALENDAR", "VEVENT"]:
            tz = next((p.partition("=")[2].strip('"') for p in key.split(";")[1:]
                       if p.upper().startswith("TZID=")), None)
            value = re.sub(r"\\([\\,;nN])", lambda m: "\n" if m[1].lower() == "n" else m[1], value)
            fields[name] = (value, tz)
    if stack:
        raise ValueError("Incomplete calendar")
