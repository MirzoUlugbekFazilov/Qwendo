"""Canonical category taxonomy shared by scrapers, API filters and the UI.

Every source labels events differently (Ticketmaster has segments/genres,
Eventbrite has category ids, Luma has free-form tags). We collapse all of it
into one small set of canonical categories plus free-form tags, so filtering
behaves identically no matter where an event came from.
"""

from __future__ import annotations

import re

CANONICAL_CATEGORIES: dict[str, str] = {
    "tech": "Tech",
    "business": "Business",
    "music": "Music",
    "film": "Film & Fandom",
    "gaming": "Gaming",
    "arts": "Arts & Culture",
    "comedy": "Comedy",
    "sports": "Sports",
    "food": "Food & Drink",
    "wellness": "Health & Wellness",
    "community": "Community",
    "nightlife": "Nightlife",
    "education": "Learning",
    "family": "Family",
}

# Ordered most-specific first: the first match wins for the primary category.
_KEYWORD_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("tech", ("hackathon", "artificial intelligence", " ai ", "machine learning", "llm", "developer",
              "software", "startup", "founder", "web3", "blockchain", "crypto", "cybersecurity",
              "devops", "data science", "saas", "product management", "ux", "coding", "python",
              "javascript", "engineering meetup", "tech ")),
    ("gaming", ("esports", "gaming", "video game", "xbox", "playstation", "nintendo", "lan party",
                "board game", "dungeons & dragons", "dungeons and dragons", "tabletop", "game jam")),
    ("film", ("comic con", "comiccon", "marvel", "spider-man", "spiderman", "superhero", "cosplay",
              "anime", "manga", "fan meet", "fan convention", "screening", "film festival", "cinema",
              "premiere", "star wars", "dc comics", "autograph")),
    ("comedy", ("comedy", "stand-up", "stand up", "improv", "open mic night", "sketch show")),
    ("music", ("concert", "live music", "dj ", "techno", "house music", "gig", "band", "tour",
               "festival", "orchestra", "symphony", "opera", "jazz", "hip hop", "hip-hop", "rap",
               "acoustic", "album launch", "rave")),
    ("sports", ("football", "soccer", "basketball", "nba", "boxing", "mma", "ufc", "marathon",
                "5k", "10k", "parkrun", "cycling", "tennis", "rugby", "cricket", "formula 1",
                "motogp", "wrestling", "match day", "fixture")),
    ("arts", ("theatre", "theater", "musical", "ballet", "exhibition", "gallery", "museum",
              "private view", "life drawing", "pottery", "painting", "sculpture", "photography walk",
              "dance class", "west end")),
    ("food", ("food festival", "street food", "tasting", "supper club", "wine", "brewery", "beer",
              "cocktail", "whisky", "cooking class", "chef", "dining", "brunch", "bottomless")),
    ("wellness", ("yoga", "meditation", "mindfulness", "breathwork", "sound bath", "wellness",
                  "fitness", "bootcamp", "hiit", "pilates", "retreat", "mental health", "hiking",
                  "sauna", "run club")),
    ("business", ("networking", "business", "investor", "investing", "finance", "fintech",
                  "marketing", "career fair", "job fair", "leadership", "entrepreneur", "pitch night",
                  "b2b", "sales", "mixer")),
    ("education", ("conference", "summit", "workshop", "masterclass", "bootcamp", "seminar",
                   "lecture", "talk", "panel", "course", "training", "keynote", "symposium")),
    ("nightlife", ("club night", "nightlife", "after party", "afterparty", "rooftop party",
                   "bar crawl", "late night", "party")),
    ("community", ("volunteer", "charity", "fundraiser", "community", "language exchange",
                   "book club", "author talk", "poetry", "spoken word", "meetup", "social club")),
    ("family", ("family", "kids", "children", "toddler", "half term", "family-friendly")),
]

# Ticketmaster Discovery API segments → canonical
_TICKETMASTER_SEGMENTS = {
    "music": "music",
    "sports": "sports",
    "arts & theatre": "arts",
    "film": "film",
    "miscellaneous": "community",
    "family": "family",
    "comedy": "comedy",
}

# Eventbrite category names → canonical
_EVENTBRITE_CATEGORIES = {
    "business & professional": "business",
    "science & technology": "tech",
    "music": "music",
    "film, media & entertainment": "film",
    "performing & visual arts": "arts",
    "sports & fitness": "sports",
    "health & wellness": "wellness",
    "food & drink": "food",
    "community & culture": "community",
    "hobbies & special interest": "community",
    "charity & causes": "community",
    "family & education": "education",
    "nightlife": "nightlife",
    "travel & outdoor": "wellness",
    "fashion & beauty": "arts",
    "home & lifestyle": "community",
    "auto, boat & air": "community",
    "government & politics": "community",
    "religion & spirituality": "community",
    "school activities": "education",
    "other": "community",
}


def map_source_category(source: str, raw_value: str | None) -> str | None:
    if not raw_value:
        return None
    key = raw_value.strip().lower()
    if source == "ticketmaster":
        return _TICKETMASTER_SEGMENTS.get(key)
    if source == "eventbrite":
        return _EVENTBRITE_CATEGORIES.get(key)
    return key if key in CANONICAL_CATEGORIES else None


def infer_categories(*texts: str | None, seed: list[str] | None = None, limit: int = 3) -> list[str]:
    """Derive canonical categories from free text, keeping any seeded ones first."""
    haystack = " " + re.sub(r"\s+", " ", " ".join(t or "" for t in texts).lower()) + " "
    found: list[str] = [c for c in (seed or []) if c in CANONICAL_CATEGORIES]

    for category, keywords in _KEYWORD_RULES:
        if category in found:
            continue
        if any(keyword in haystack for keyword in keywords):
            found.append(category)
        if len(found) >= limit:
            break

    return found or ["community"]


def extract_tags(*texts: str | None, limit: int = 12) -> list[str]:
    """Lightweight keyword tags used for faceting and the full-text index."""
    haystack = " ".join(t or "" for t in texts).lower()
    tags: list[str] = []
    for _, keywords in _KEYWORD_RULES:
        for keyword in keywords:
            cleaned = keyword.strip()
            if len(cleaned) > 2 and cleaned in haystack and cleaned not in tags:
                tags.append(cleaned)
            if len(tags) >= limit:
                return tags
    return tags


def build_interest_text(
    interest_labels: list[str],
    interest_keywords: list[str],
    free_text: str | None = None,
    city: str | None = None,
) -> str:
    """Compose the string that becomes a user's taste embedding.

    Keywords are repeated alongside labels so that the local hashed embedder has
    enough vocabulary overlap with event descriptions to be useful.
    """
    parts: list[str] = []
    if interest_labels:
        parts.append("Interested in " + ", ".join(interest_labels) + ".")
    if interest_keywords:
        parts.append(" ".join(interest_keywords))
    if free_text:
        parts.append(free_text.strip())
    if city:
        parts.append(f"Events in {city}.")
    return " ".join(part for part in parts if part).strip()


def event_embedding_text(
    title: str,
    description: str | None = None,
    categories: list[str] | None = None,
    tags: list[str] | None = None,
    venue: str | None = None,
    city: str | None = None,
    organizer: str | None = None,
) -> str:
    """Compose the string that becomes an event's embedding."""
    labels = [CANONICAL_CATEGORIES.get(c, c) for c in (categories or [])]
    pieces = [
        title,
        title,  # title weighted twice: it carries the strongest signal
        ", ".join(labels),
        " ".join(tags or []),
        organizer or "",
        f"{venue or ''} {city or ''}".strip(),
        (description or "")[:2000],
    ]
    return " ".join(piece for piece in pieces if piece).strip()
