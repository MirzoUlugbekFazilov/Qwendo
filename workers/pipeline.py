"""Legacy ingestion is retired. The discovery queue owns event writes."""


async def upsert_events(*args, **kwargs):
    raise RuntimeError("Use workers.discovery_jobs with a permitted discovery source.")
