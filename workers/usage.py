"""Per-attempt metering shared by authorised connectors and the queue worker."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class RequestTotals:
    requests: int = 0
    billable_requests: int = 0


_active: ContextVar[RequestTotals | None] = ContextVar("discovery_requests", default=None)


@contextmanager
def measure_requests():
    totals = RequestTotals()
    token = _active.set(totals)
    try:
        yield totals
    finally:
        _active.reset(token)


def count_request(billable: bool = False):
    totals = _active.get()
    if totals is not None:
        totals.requests += 1
        totals.billable_requests += int(billable)
