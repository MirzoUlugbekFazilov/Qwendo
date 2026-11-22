"""Bounded PostgREST queries for the deterministic ranker."""
import asyncio
import math

from api.catalogue import LIST_COLUMNS, literal, overlap, public_filters
from api.discovery_ranking import ALIASES, CITY_CENTRES, norm

RANK_COLUMNS = LIST_COLUMNS + ",raw,last_seen_at,meaningful_updated_at"
HISTORY_COLUMNS = "event_id,state,events(id,title,starts_at,venue_name,address,city,country,tags,categories,canonical_event_id)"


def origin_for(profile, location):
    city = norm(profile.get("city"))
    if location and norm(location.get("city")) == city and all(
        location.get(key) is not None for key in ("lat", "lng")
    ):
        return location["lat"], location["lng"]
    return CITY_CENTRES.get(city)


async def load_candidates(db, profile, now, *, origin=None, filters=None, limit=300):
    base = {**public_filters(now), **(filters or {})}
    if profile.get("online") is False:
        base["is_online"] = "eq.false"
    city = profile.get("city")
    if (city or origin) and not profile.get("flexible_travel"):
        # A latitude band includes nearby towns and crosses the date line safely.
        places = [f"city.ilike.{literal(city)}"] if city else []
        if profile.get("online") is not False:
            places.append("is_online.eq.true")
        if origin:
            delta = profile.get("radius", 25) / 68
            bounds = [f"lat.gte.{origin[0]-delta}", f"lat.lte.{origin[0]+delta}"]
            latitude = min(abs(origin[0]) + delta, 90)
            if latitude < 90:
                longitude_delta = delta / math.cos(math.radians(latitude))
                west, east = origin[1] - longitude_delta, origin[1] + longitude_delta
                if -180 <= west and east <= 180:
                    bounds.extend((f"lng.gte.{west}", f"lng.lte.{east}"))
            places.append("and(" + ",".join(bounds) + ")")
        base["or"] = "(" + ",".join(places) + ")"

    budget = profile.get("budget")
    if profile.get("budget_strict") and budget is not None:
        clause = f"or(is_free.eq.true,and(currency.eq.GBP,price_min.lte.{budget}))"
        prior = base.get("and", "()")[1:-1]
        base["and"] = "(" + ",".join(filter(None, (prior, clause))) + ")"

    async def select(extra, order):
        return await db.select("events", columns=RANK_COLUMNS, filters={**base, **extra},
                               order=order, limit=limit) or []

    queries = [select({}, "starts_at,id")]
    if "id" not in base:
        queries.append(select({}, "first_seen_at.desc,starts_at,id"))
        if profile.get("categories") and "categories" not in base:
            queries.append(select({"categories": overlap(profile["categories"])}, "starts_at,id"))
        terms = set()
        for interest in profile.get("interests", []):
            for name in [interest["name"], *interest.get("related", [])]:
                phrase = norm(name)
                if phrase:
                    terms.update(next((group for group in ALIASES if phrase in group), (phrase,)))
        if terms:
            query = " OR ".join('"' + term + '"' for term in sorted(terms))
            queries.append(select({"search_tsv": "wfts(english)." + query}, "starts_at,id"))
    batches = await asyncio.gather(*queries)
    return list({row["id"]: row for batch in batches for row in batch}.values())
