"""Deterministic discovery ranking over normalized catalogue rows."""
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from api.catalogue import instant, public_event
from core.config import settings
from core.taxonomy import CANONICAL_CATEGORIES

WEIGHTS = settings.ranking_weights
CATEGORY_LABELS = {
    "tech": "Technology & AI", "film": "Films & fandoms", "music": "Music & concerts",
    "business": "Startups & business", "gaming": "Gaming & esports", "sports": "Sports & fitness",
    "arts": "Arts & culture", "food": "Food & drink", "education": "Science & education",
    "fashion": "Fashion & lifestyle", "comedy": "Comedy & entertainment",
    "wellness": "Wellness & community",
}
ALIASES = (
    ("ai", "artificial intelligence"), ("ml", "machine learning"),
    ("sci fi", "scifi", "science fiction"), ("kpop", "k pop"),
    ("dnb", "drum and bass"), ("d d", "dungeons dragons", "dungeons and dragons"),
    ("spiderman", "spider man"), ("comic con", "comiccon"),
    ("f1", "formula 1", "formula one"),
)


AVAILABILITY = {
    "available": "available", "instock": "available", "in_stock": "available",
    "soldout": "sold out", "sold_out": "sold out", "limited": "limited",
    "limitedavailability": "limited", "outofstock": "unavailable", "out_of_stock": "unavailable",
    "unavailable": "unavailable", "onsale": "on sale", "on_sale": "on sale",
    "offsale": "off sale", "off_sale": "off sale", "presale": "presale",
    "preorder": "preorder", "pre_order": "preorder", "waitlist": "waitlist",
}

PREFERENCE_TERMS = {
    "Have fun and make memories": ("concert", "comedy", "festival", "games"),
    "Meet like-minded people": ("meetup", "fan gathering", "community"),
    "Make new friends": ("social", "mixer", "meetup"),
    "Grow my professional network": ("networking", "business mixer"),
    "Learn new things": ("workshop", "lecture", "class", "masterclass"),
    "Advance my career": ("career", "recruitment", "professional development"),
    "Meet favourite artists or creators": ("meet and greet", "signing", "fan gathering"),
    "Try something completely new": ("introductory", "taster", "beginners"),
    "Conferences and talks": ("conference", "summit", "talk", "lecture", "panel"),
    "Networking and meetups": ("networking", "meetup", "mixer"),
    "Workshops and classes": ("workshop", "class", "masterclass"),
    "Hackathons and competitions": ("hackathon", "competition", "game jam"),
    "Concerts and live performances": ("concert", "gig", "live performance", "live music"),
    "Conventions and fan gatherings": ("convention", "comic con", "fan gathering"),
    "Film screenings and premieres": ("screening", "premiere"),
    "Exhibitions and pop-ups": ("exhibition", "pop up"),
    "Community and social activities": ("community", "social", "volunteer"),
}

# City-centre origins when the profile has no more precise coordinates.
CITY_CENTRES = {
    "london": (51.5074, -.1278), "manchester": (53.4808, -2.2426),
    "birmingham": (52.4862, -1.8904), "edinburgh": (55.9533, -3.1883),
    "bristol": (51.4545, -2.5879), "new york": (40.7128, -74.0060),
    "san francisco": (37.7749, -122.4194), "berlin": (52.52, 13.405),
    "paris": (48.8566, 2.3522), "amsterdam": (52.3676, 4.9041),
    "dubai": (25.2048, 55.2708), "tashkent": (41.2995, 69.2401),
}


def norm(value):
    return " ".join(re.findall(r"\w+", (value or "").casefold()))


def mentions(corpus, term):
    term = norm(term)
    variants = next((group for group in ALIASES if term in group), (term,))
    return bool(term and any(f" {variant} " in corpus for variant in variants))


def identity(event):
    place = norm(event.get("venue_name") or event.get("address"))
    if place and event.get("city"):
        return (norm(event["title"]), instant(event["starts_at"]), place,
                norm(event["city"]), norm(event.get("country")))
    if event.get("url") and event.get("starts_at"):
        return (event["url"], instant(event["starts_at"]))
    return (event["id"],)


def miles(origin, event):
    if origin is None or event.get("lat") is None or event.get("lng") is None:
        return None
    a, b, c, d = map(math.radians, (*origin, event["lat"], event["lng"]))
    h = math.sin((c-a)/2)**2 + math.cos(a)*math.cos(c)*math.sin((d-b)/2)**2
    return 7917.52 * math.asin(math.sqrt(min(1, max(0, h))))


def schedule(label, start, timezone):
    label = norm(label)
    if label in ("", "anytime", "any time", "flexible", "any day"):
        return True
    try:
        local = start.astimezone(ZoneInfo(timezone or ""))
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return False
    weekend = local.weekday() >= 5
    evening = local.hour >= 17
    return {
        "weekends": weekend, "weekdays": not weekend,
        "weekday evenings": not weekend and evening, "evenings": evening,
        "weekday daytime": not weekend and 9 <= local.hour < 17,
        "weekend daytime": weekend and 9 <= local.hour < 17,
    }.get(label, False)


def sufficient_notice(label, lead):
    return {"": True, "any time": True, "this week": lead < timedelta(days=7),
            "1 4 weeks": timedelta(days=7) <= lead <= timedelta(weeks=4),
            "more than a month": lead > timedelta(days=30)}.get(norm(label), False)


def signals(event):
    return {norm(x) for x in [*(event.get("tags") or []), *(event.get("categories") or [])] if x}


def score_event(event, p, now, origin, learning):
    event = public_event(event, now)
    if event is None:
        return None
    start = instant(event["starts_at"])
    distance = miles(origin, event)
    same_city = bool(p.get("city")) and norm(p.get("city")) == norm(event.get("city"))
    radius = p.get("radius", 25)
    local = distance <= radius if distance is not None else same_city
    if event.get("is_online"):
        if p.get("online") is False:
            return None
        local = True
    elif (p.get("city") or origin) and not local and not p.get("flexible_travel"):
        return None

    price = event.get("price_min") if event.get("currency") == "GBP" else None
    budget = p.get("budget")
    affordable = budget is None or event.get("is_free") or (price is not None and price <= budget)
    available = schedule(p.get("availability"), start, event.get("timezone"))
    notice = sufficient_notice(p.get("notice"), start-now)
    if any(p.get(key + "_strict") and not ok for key, ok in
           (("budget", affordable), ("availability", available), ("notice", notice))):
        return None

    tags = signals(event)
    fields = [event.get(k) for k in ("title", "organizer", "summary", "description")]
    corpus = " " + " | ".join(norm(s) for s in [*fields, *sorted(tags)] if s) + " "

    reviewed_matches = []
    suggestions = []
    for interest in p.get("interests", []):
        name = interest["name"]
        direct = mentions(corpus, name)
        if not direct and not any(mentions(corpus, term) for term in interest.get("related", [])):
            continue
        weight = {"must": 1, "very": .85, "curious": .65}.get(interest.get("priority"), .65)
        if interest.get("source") == "inferred" and not interest.get("confirmed"):
            weight *= max(0, min(1, interest.get("confidence", 0))) * .6
        if weight:
            unconfirmed = interest.get("source") == "inferred" and not interest.get("confirmed")
            target = suggestions if unconfirmed or not direct else reviewed_matches
            target.append((weight * (1 if direct else .6), name))
    reviewed_strength, reviewed = max(reviewed_matches, default=(0, None))
    suggested_strength, suggested = max(suggestions, default=(0, None))
    strength = max(reviewed_strength, suggested_strength)
    # The onboarding taxonomy groups some of the narrower catalogue categories.
    if "community" in tags:
        tags.add("wellness")
    if mentions(corpus, "fitness"):
        tags.add("sports")
    category = next((CATEGORY_LABELS.get(c, CANONICAL_CATEGORIES.get(c, c)) for c in p.get("categories", [])
                     if c in CANONICAL_CATEGORIES and (norm(c) in tags or mentions(corpus, c))), None)
    preferences = [*p.get("formats", []), *p.get("motivations", [])]
    preferred = next((label for label in preferences if any(
        mentions(corpus, term) for term in (label, *PREFERENCE_TERMS.get(label, ()))
    )), None)
    affinity = sum(learning[tag] for tag in tags)
    proximity = float(local)
    if distance is not None and not event.get("is_online"):
        proximity = max(0, 1 - distance / max(radius, 1))
    topical = min(1, max(strength, .55 if category else 0) + .15 * math.tanh(affinity / 3))
    score = (WEIGHTS["topical"] * topical + WEIGHTS["experience"] * bool(preferred)
             + WEIGHTS["location"] * proximity + WEIGHTS["timing"] * (available + notice) / 2
             + WEIGHTS["budget"] * bool(affordable))
    matched = reviewed or category or suggested
    reason = (f"Topic match for {reviewed}." if reviewed else
              f"Matches your category, {category}." if category else
              f"Suggested because this listing may relate to {suggested}." if suggested else
              f"Matches your preference for {preferred}." if preferred else
              "Similar to events you saved." if affinity > 0 else "An exploratory pick.")
    if preferred and (reviewed or category):
        reason += f" Also fits your preference for “{preferred}”."
    zone = event.get("timezone")
    try:
        ZoneInfo(zone or "")
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        zone = None
    return {
        **{k: v for k, v in event.items() if k != "raw"},
        "timezone": zone, "score": score / sum(WEIGHTS.values()), "reason": reason,
        "matched_interest": matched, "exploratory": not (reviewed or category),
        "distance_miles": distance, "distance_km": distance * 1.609344 if distance is not None else None,
        "discovered_at": event.get("first_seen_at"), "availability": AVAILABILITY.get(str((event.get("raw") or {}).get("availability")), "unknown"),
    }


def rank_events(events, profile, history, now, origin=None):
    profile = profile or {}
    origin = origin or CITY_CENTRES.get(norm(profile.get("city")))
    dismissed = set()
    learning = Counter()
    for entry in history:
        event = entry.get("events") or {}
        if entry["state"] == "dismissed":
            dismissed.add((entry["event_id"],))
            if event.get("canonical_event_id"):
                dismissed.add((event["canonical_event_id"],))
            if event:
                dismissed.add(identity(event))
            continue
        for tag in signals(event):
            learning[tag] += {"saved": 1, "going": 2}[entry["state"]]

    groups = defaultdict(list)
    for event in events:
        groups[identity(event)].append(event)
    picks = []
    for key, rows in groups.items():
        if key in dismissed or any((r["id"],) in dismissed for r in rows):
            continue
        candidates = [item for r in rows if (item := score_event(r, profile, now, origin, learning))]
        if not candidates:
            continue
        candidates.sort(key=lambda item: (
            instant(item["discovered_at"]) is None, instant(item["discovered_at"]), item["id"]))
        item = candidates[0].copy()
        item["official_links"] = list(dict.fromkeys(c["official_url"] for c in candidates if c.get("official_url")))
        picks.append(item)
    return sorted(picks, key=lambda i: (-i["score"], instant(i["starts_at"]), i["id"]))
