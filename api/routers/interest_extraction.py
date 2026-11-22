"""Authenticated interest suggestions for discovery onboarding."""
import hashlib
import json
import math
import re
import time
from collections import OrderedDict
from threading import Lock
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from api.deps import CurrentUser

router = APIRouter(tags=["me"])

Category = Literal["tech", "film", "music", "business", "gaming", "sports", "arts",
                   "food", "education", "fashion", "comedy", "wellness"]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Evidence = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ExtractionRequest(StrictModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    categories: list[Category] = Field(max_length=12)


class Interest(StrictModel):
    name: Label
    type: Label
    source: Literal["explicit", "inferred"]
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    related: list[Label] = Field(max_length=8)
    priority: Literal["must", "very", "curious"]
    source_text: Evidence
    confirmed: bool


class Candidates(StrictModel):
    interests: list[Interest] = Field(max_length=20)


class ExtractionResult(Candidates):
    mode: Literal["fallback"]


_ALIASES = {
    "f1": "Formula 1", "formula one": "Formula 1", "formula 1": "Formula 1",
    "ai": "Artificial Intelligence", "ml": "Machine Learning",
    "sci-fi": "Science Fiction", "scifi": "Science Fiction",
    "kpop": "K-pop", "dnb": "Drum and Bass", "d&d": "Dungeons & Dragons",
}
_SPLIT = re.compile(r",|\s+(?:and|or|also)\s+", re.I)
_RADAR = re.compile(
    r"^(?:(?:i\s+)?(?:never want to|don['’]t want to|must never)|"
    r"(?:i(?:['’]d| would)?\s+)?hate to)\s+miss\b\s*", re.I,
)
_PREFIX = re.compile(
    r"^(?:(?:i(?:'m|’m| am)?\s+)?(?:really\s+)?"
    r"(?:like|love|enjoy|follow|want to explore|am into|into|interested in|curious about)\b"
    r"|(?:my\s+)?interests?\s*(?:include|are|:))\s*", re.I,
)
_NEGATIVE = re.compile(r"\b(?:not|never|no|dislike|hate|avoid|don['’]t)\b", re.I)


def parse_interests(text: str) -> list[Interest]:
    interests = []
    seen = set()
    for sentence in re.split(r"[.!?;\n]+|\bbut\b", text, flags=re.I):
        negative = False
        priority = "curious"
        for phrase in _SPLIT.split(sentence):
            phrase = phrase.strip()
            if _RADAR.match(phrase):
                phrase = _RADAR.sub("", phrase, count=1)
                priority = "must"
                negative = False
            elif _PREFIX.match(phrase):
                priority = "curious"
                negative = False
            if _NEGATIVE.search(phrase):
                negative = True
                continue
            evidence = _PREFIX.sub("", phrase, count=1).strip(" \t:\"“”")
            if negative or not evidence or len(evidence) > 100 or len(evidence.split()) > 10:
                continue
            name = _ALIASES.get(evidence.casefold(), evidence)
            if name.casefold() in seen or not any(c.isalnum() for c in name):
                continue
            seen.add(name.casefold())
            interests.append(Interest(name=name, type="topic", source="explicit", confidence=1,
                                      related=[], priority=priority, source_text=evidence,
                                      confirmed=False))
            if len(interests) == 20:
                return interests
    return interests


_RATE_LIMIT = 12
_WINDOW = 60
_CACHE_SECONDS = 300
_lock = Lock()
_windows: OrderedDict[str, tuple[float, int]] = OrderedDict()
_cache: OrderedDict[tuple[str, bytes], tuple[float, ExtractionResult]] = OrderedDict()


def _admit(user_id: str, now: float):
    # Fixed windows in insertion order. Never evict a live window to admit a new user.
    while _windows and next(iter(_windows.values()))[0] <= now:
        _windows.popitem(last=False)
    deadline, count = _windows.get(user_id, (now + _WINDOW, 0))
    if count >= _RATE_LIMIT or (count == 0 and len(_windows) >= 2048):
        raise HTTPException(429, "Too many extraction requests.", headers={
            "Retry-After": str(math.ceil(deadline - now)), "Cache-Control": "private, no-store",
        })
    _windows[user_id] = deadline, count + 1


@router.post("/me/discovery/extract", response_model=ExtractionResult)
async def extract(payload: ExtractionRequest, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    user_id = user["id"]
    digest = hashlib.sha256(json.dumps([payload.text, sorted(set(payload.categories))]).encode()).digest()
    key = user_id, digest
    with _lock:
        now = time.monotonic()
        _admit(user_id, now)
        cached = _cache.get(key)
        if cached and cached[0] > now:
            _cache.move_to_end(key)
            return cached[1]

    result = ExtractionResult(interests=parse_interests(payload.text), mode="fallback")
    with _lock:
        _cache[key] = time.monotonic() + _CACHE_SECONDS, result
        _cache.move_to_end(key)
        if len(_cache) > 512:
            _cache.popitem(last=False)
    return result
