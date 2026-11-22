"""Translate ordinary event searches into precise catalogue filters."""

import re

# These event formats have regular plurals. Only correct adjacent key swaps in
# this small vocabulary so names and unfamiliar search terms stay searchable.
_FORMATS = (
    "concert", "conference", "exhibition", "festival", "hackathon", "lecture",
    "marathon", "meetup", "screening", "seminar", "summit", "webinar", "workshop",
)
_FORMAT_WORDS = {word: fmt for fmt in _FORMATS for word in (fmt, fmt + "s")}


def event_format(word: str) -> str | None:
    if word in _FORMAT_WORDS:
        return _FORMAT_WORDS[word]
    for i in range(len(word) - 1):
        swapped = word[:i] + word[i + 1] + word[i] + word[i + 2:]
        if swapped in _FORMAT_WORDS:
            return _FORMAT_WORDS[swapped]
    return None


def catalogue_query(query: str) -> tuple[str, list[str]]:
    """Return the full-text query and additional format evidence requirements."""
    query = query.strip()
    if re.search(r'"|(?:^|\s)-\S|\bor\b', query, re.IGNORECASE):
        return query, []

    formats: list[str] = []

    def normalize(match: re.Match[str]) -> str:
        word = match[0].lower()
        if word in {"event", "events"}:
            return ""
        fmt = event_format(word)
        if fmt and fmt not in formats:
            formats.append(fmt)
        return fmt or match[0]

    normalized = " ".join(re.sub(r"\w+", normalize, query).split())
    # Weight A belongs exclusively to the event title. A format tag also
    # identifies branded events whose titles omit the type.
    conditions = [
        f'or(search_tsv.fts(english).{fmt}:A,tags.ov."{{{fmt},{fmt}s}}")'
        for fmt in formats
    ]
    return normalized or query, conditions
