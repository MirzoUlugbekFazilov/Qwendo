"""Bounded, task-local evidence for incomplete publisher records."""

from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256

from .fetch import checked_url

_active = ContextVar("connector_reviews", default=None)


class VerificationFailure(ValueError):
    """The permitted publisher response supplied no usable event evidence."""


@contextmanager
def collect_reviews():
    """Collect discovery_reviews-shaped rows, including when discover raises."""
    rows = []
    parent = _active.get()
    token = _active.set(rows)
    try:
        yield rows
    finally:
        _active.reset(token)
        if parent is not None:
            parent.extend(rows[:max(0, 200 - len(parent))])


def review(row, reason, url=None, title=None, uid=None, reported_start=None):
    rows = _active.get()
    if rows is None or len(rows) >= 200:
        return
    listing = {}
    try:
        checked_url(url, row["allowed_hosts"])
        listing["url"] = url
    except ValueError:
        pass
    if isinstance(title, str) and title.strip():
        listing["title"] = title.strip()[:500]
    if isinstance(reported_start, str) and reported_start.strip():
        listing["reported_start"] = reported_start.strip()[:120]
    evidence_url = listing.get("url", row["url"])
    identity = uid if isinstance(uid, (str, int)) and uid else listing.get("url")
    if not identity:
        identity = sha256((evidence_url + "|" + listing.get("title", "") + "|" + reason).encode()).hexdigest()
    external_id = str(identity)[:2048]
    listing["external_id"] = external_id
    record = dict(source_slug=row["slug"], external_id=external_id, reason=reason, listing=listing,
                  evidence=dict(verification_status="pending_review", url=evidence_url, reason=reason))
    if record not in rows:
        rows.append(record)
