"""Seed a realistic demo catalogue — DEVELOPMENT ONLY.

These events do not exist, so they have no ticket page to link to: their `url`
points at a marketplace *search* page. That breaks Qwendo's promise of sending
users to the exact official listing, which is why `core.links` classifies them
as 'listing' and `python -m workers.run links` flags them.

Use this to develop offline. Before showing the product to anyone, run a real
ingestion and clear these rows:

    delete from public.events where source = 'demo';

Rows are written with `source='demo'` so they are always trivially removable.
Dates are generated relative to today so the feed is never stale.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from core.models import NormalizedEvent
from core.supabase import SupabaseClient, service_client
from core.text import make_summary
from workers.pipeline import upsert_events

log = logging.getLogger("qwendo.seed")

LONDON = (51.5074, -0.1278)

# (offset_days, hour, title, venue, coords, categories, tags, price, description)
DEMO_EVENTS: list[tuple] = [
    (4, 19, "Spider-Man: Across the Spider-Verse — Cast Panel & Fan Meet",
     "ExCeL London", (51.5085, 0.0294), ["film"], ["comic con", "marvel", "spiderman", "superhero", "fan meet"],
     38.0, "GBP",
     "A full-day fan meet dedicated to the Spider-Verse: cast panel, Q&A, cosplay parade and an exclusive first look at upcoming Marvel animation. Autograph sessions run all afternoon."),
    (11, 10, "London Comic Con Spring Edition",
     "Olympia London", (51.4965, -0.2104), ["film", "gaming"], ["comic con", "cosplay", "marvel", "dc comics", "anime"],
     29.5, "GBP",
     "Three halls of comics, collectibles and cosplay. Superhero artists, voice-actor panels, retro gaming arcade and the UK's largest cosplay masquerade."),
    (6, 9, "AI Engineering Summit London",
     "Convene 22 Bishopsgate", (51.5155, -0.0817), ["tech", "education"], ["artificial intelligence", "machine learning", "llm", "developer"],
     149.0, "GBP",
     "A single-track day on shipping LLM products: evaluation, retrieval, agents in production and cost control. Talks from engineering leads at UK AI startups plus an evening networking reception."),
    (9, 18, "Founders & Funders: Seed Stage Networking",
     "Second Home Spitalfields", (51.5194, -0.0735), ["business", "tech"], ["networking", "startup", "founders", "venture capital", "pitch night"],
     0.0, "GBP",
     "Curated networking for pre-seed and seed founders with angels and early-stage VCs. Five-minute lightning pitches, then open floor. Free, but capacity is capped at 120."),
    (13, 9, "Hack the City — 48h London Hackathon",
     "Imperial College London", (51.4988, -0.1749), ["tech"], ["hackathon", "coding", "developer", "artificial intelligence"],
     0.0, "GBP",
     "A weekend build sprint with tracks in AI, fintech and civic tech. Hardware lab, mentors from eight sponsors, £10k prize pool. Teams of up to four; solo hackers matched on arrival."),
    (3, 19, "Women in Tech London Meetup",
     "Google Academy, Victoria", (51.4952, -0.1441), ["tech", "community"], ["developer", "networking", "career", "meetup"],
     0.0, "GBP",
     "Monthly meetup with two technical talks and structured mentoring speed-rounds. This month: platform engineering and switching from IC to staff+ roles."),
    (7, 20, "Arctic Monkeys — The O2 Arena",
     "The O2 Arena", (51.5030, 0.0032), ["music"], ["concert", "live music", "rock", "indie", "tour"],
     65.0, "GBP",
     "The band's only London date this year, touring the new record with a full production show. Doors 18:30, support act at 19:30."),
    (5, 22, "Fabric Presents: Techno All Night",
     "fabric", (51.5199, -0.1026), ["music", "nightlife"], ["electronic", "techno", "dj", "club night", "rave"],
     25.0, "GBP",
     "Three rooms, eight hours, headline techno and minimal across Room One. Over-19s only, ID required."),
    (18, 19, "Jazz at Ronnie Scott's: Late Show",
     "Ronnie Scott's Jazz Club", (51.5135, -0.1320), ["music"], ["jazz", "soul", "live music", "jam session"],
     35.0, "GBP",
     "The legendary Soho late show — a resident quintet plus guests, running until 3am. Table service throughout."),
    (21, 14, "Premier League: Arsenal vs Chelsea",
     "Emirates Stadium", (51.5549, -0.1084), ["sports"], ["football", "premier league", "match day", "fixture"],
     80.0, "GBP",
     "North London derby weekend fixture. Ticket includes stadium entry from two hours before kick-off."),
    (10, 19, "London Marathon Training Clinic",
     "Regent's Park", (51.5313, -0.1570), ["sports", "wellness"], ["running", "marathon", "fitness", "run club"],
     0.0, "GBP",
     "Free pace-group session with coaches covering taper strategy, fuelling and race-day pacing. All levels; 5k and 10k loops available."),
    (8, 18, "Wine Tasting: Natural Wines of Southern Europe",
     "Borough Market", (51.5055, -0.0910), ["food"], ["wine", "tasting", "cocktail", "supper club"],
     45.0, "GBP",
     "Eight pours guided by a sommelier, matched with small plates. Covers orange, pét-nat and low-intervention reds from Italy, Spain and Portugal."),
    (14, 12, "Street Food Festival: Flavours of Asia",
     "Southbank Centre Square", (51.5055, -0.1167), ["food", "community"], ["food festival", "street food", "dining"],
     0.0, "GBP",
     "Forty traders across East and Southeast Asian cuisines, live cooking demos and a night market from 17:00. Free entry, pay per dish."),
    (12, 19, "Stand-up Comedy: New Material Night",
     "Soho Theatre", (51.5143, -0.1325), ["comedy"], ["comedy", "stand up", "open mic", "comedy club"],
     12.0, "GBP",
     "Six circuit regulars trying out unpolished new sets, plus a headline guest announced on the night. Expect chaos; that's the point."),
    (16, 19, "Hamilton — West End",
     "Victoria Palace Theatre", (51.4964, -0.1428), ["arts"], ["theatre", "musical", "west end", "stage"],
     49.5, "GBP",
     "The multi-award-winning musical in its long-running West End production. Evening performance, running time 2h45 including interval."),
    (19, 10, "Tate Modern: Contemporary Photography Exhibition",
     "Tate Modern", (51.5076, -0.0994), ["arts"], ["exhibition", "gallery", "museum", "photography walk"],
     18.0, "GBP",
     "A survey of documentary photography from the last decade, with a weekend curator's tour and a late-opening private view."),
    (2, 18, "Yoga & Sound Bath Reset",
     "Shoreditch Studios", (51.5265, -0.0784), ["wellness"], ["yoga", "meditation", "sound bath", "mindfulness", "breathwork"],
     22.0, "GBP",
     "Ninety minutes of slow vinyasa followed by a crystal-bowl sound bath. Mats and bolsters provided; suitable for complete beginners."),
    (15, 19, "Esports Night: Valorant London Open",
     "Red Bull Gaming Sphere", (51.5327, -0.0902), ["gaming"], ["esports", "gaming", "tournament", "video game"],
     15.0, "GBP",
     "Open-bracket Valorant tournament with live casting on the main stage. Spectator tickets include arcade access and BYO-PC warm-up rooms."),
    (23, 11, "Board Game Social: Strategy Sunday",
     "Draughts Hackney", (51.5416, -0.0556), ["gaming", "community"], ["board games", "tabletop", "card games", "social club"],
     7.0, "GBP",
     "Six hundred games on the shelf, hosts who teach rules, and a sign-up board to find a table. Ticket covers unlimited play all afternoon."),
    (17, 18, "Product Design Portfolio Review",
     "Figma London", (51.5141, -0.0999), ["tech", "arts"], ["ux", "ui design", "product design", "design systems", "career"],
     0.0, "GBP",
     "Bring a case study, get twenty minutes of structured critique from senior product designers. Twenty-four slots, released in two waves."),
    (25, 19, "Crypto & Web3 Builders Meetup",
     "Huckletree Shoreditch", (51.5261, -0.0810), ["tech", "business"], ["crypto", "blockchain", "web3", "ethereum", "networking"],
     0.0, "GBP",
     "Technical talks on account abstraction and rollup tooling, followed by open networking. Builders only — no token pitches."),
    (20, 18, "Spanish–English Language Exchange",
     "The Phoenix, Soho", (51.5129, -0.1333), ["community", "education"], ["language exchange", "conversation club", "meetup", "social club"],
     0.0, "GBP",
     "Rotating tables, thirty minutes per language, name badges colour-coded by level. Arrive any time between 18:00 and 20:00."),
    (28, 10, "Climate Action Volunteering Day",
     "Hackney Marshes", (51.5560, -0.0380), ["community", "wellness"], ["volunteering", "charity", "community", "outdoors", "sustainability"],
     0.0, "GBP",
     "Tree planting and waterway clean-up with a local conservation trust. Tools, gloves and lunch provided; families welcome."),
    (30, 9, "Data Science Bootcamp Taster Day",
     "General Assembly London", (51.5203, -0.0859), ["education", "tech"], ["bootcamp", "data science", "course", "training", "python"],
     0.0, "GBP",
     "A hands-on introduction to pandas, model evaluation and the realities of a career switch. Laptop required; no prior Python needed."),
]

SOURCE_URLS = {
    "film": "https://www.eventbrite.co.uk/d/united-kingdom--london/comic-con/",
    "tech": "https://www.eventbrite.co.uk/d/united-kingdom--london/tech/",
    "business": "https://lu.ma/london",
    "music": "https://www.ticketmaster.co.uk/discover/concerts/london",
    "sports": "https://www.ticketmaster.co.uk/discover/sports/london",
    "arts": "https://www.ticketmaster.co.uk/discover/theater/london",
    "comedy": "https://www.eventbrite.co.uk/d/united-kingdom--london/comedy/",
    "food": "https://www.eventbrite.co.uk/d/united-kingdom--london/food-and-drink/",
    "wellness": "https://www.eventbrite.co.uk/d/united-kingdom--london/wellness/",
    "gaming": "https://www.eventbrite.co.uk/d/united-kingdom--london/gaming/",
    "community": "https://www.eventbrite.co.uk/d/united-kingdom--london/community/",
    "education": "https://www.eventbrite.co.uk/d/united-kingdom--london/courses/",
    "nightlife": "https://www.eventbrite.co.uk/d/united-kingdom--london/nightlife/",
}


def build_demo_events() -> list[NormalizedEvent]:
    base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    events: list[NormalizedEvent] = []

    for index, (days, hour, title, venue, coords, categories, tags, price, currency, description) in enumerate(
        DEMO_EVENTS
    ):
        starts_at = (base + timedelta(days=days)).replace(hour=hour)
        primary = categories[0]
        events.append(
            NormalizedEvent(
                source="demo",
                external_id=f"demo-{index:03d}",
                url=SOURCE_URLS.get(primary, "https://www.eventbrite.co.uk/d/united-kingdom--london/all-events/"),
                title=title,
                description=description,
                summary=make_summary(description),
                image_url=None,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=3),
                timezone="Europe/London",
                is_online=False,
                venue_name=venue,
                address=f"{venue}, London",
                city="London",
                country="GB",
                lat=coords[0],
                lng=coords[1],
                price_min=price,
                price_max=price if price else None,
                currency=currency,
                is_free=price == 0.0,
                organizer=venue,
                categories=categories,
                tags=tags,
                popularity=float(40 + (index * 7) % 55),
                status="active",
                raw={"seeded": True},
            )
        )
    return events


async def seed(db: SupabaseClient | None = None) -> tuple[int, int, int]:
    owns_client = db is None
    db = db or service_client()
    try:
        events = build_demo_events()
        result = await upsert_events(db, events)
        log.info("Seeded %s demo events (inserted=%s updated=%s)", len(events), result[0], result[1])
        return result
    finally:
        if owns_client:
            await db.aclose()
