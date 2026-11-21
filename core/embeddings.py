"""Embedding providers.

Two implementations behind one interface:

* ``openai``  – text-embedding-3-small (1536 dims). Real semantics: it knows a
  Spider-Man fan meet relates to "superhero" and "Marvel". Use in production.
* ``local``   – a deterministic hashed bag-of-words projection. No API key, no
  cost, no network. Cosine similarity degrades to weighted vocabulary overlap
  (plus bigrams), which is enough to develop and demo the whole pipeline.

Both emit L2-normalised vectors of ``settings.embedding_dim`` floats, so the
pgvector column and the HNSW cosine index stay valid if you switch providers —
re-embed everything when you do (``python -m workers.run embed --all``).
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter

import httpx

from core.config import settings

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'&+-]*")

_STOPWORDS = frozenset(
    """
    a an the and or but if then than that this these those of in on at to for with without from by
    is are was were be been being am do does did doing have has had having will would shall should
    can could may might must not no nor so such as it its it's we you your our their they them he
    she his her i me my mine us up down out over under again further once here there when where why
    how all any both each few more most other some only own same too very s t just don now
    event events ticket tickets join come get free online new
    """.split()
)

_OPENAI_BATCH = 96


# ── tokenisation ───────────────────────────────────────────────
def _tokenize(text: str) -> list[str]:
    tokens = [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]
    # crude singularisation keeps "hackathons" ≈ "hackathon"
    return [t[:-1] if len(t) > 4 and t.endswith("s") and not t.endswith("ss") else t for t in tokens]


def _hash_index(token: str, probe: int, dim: int) -> tuple[int, float]:
    digest = hashlib.blake2b(f"{probe}:{token}".encode(), digest_size=8).digest()
    value = int.from_bytes(digest, "big")
    return value % dim, 1.0 if (value >> 63) & 1 else -1.0


def local_embed(text: str, dim: int | None = None) -> list[float]:
    """Hashed bag-of-words + bigrams, L2-normalised."""
    dim = dim or settings.embedding_dim
    tokens = _tokenize(text)
    if not tokens:
        return [0.0] * dim

    grams = Counter(tokens)
    grams.update(f"{a}_{b}" for a, b in zip(tokens, tokens[1:]))

    vector = [0.0] * dim
    for gram, count in grams.items():
        weight = 1.0 + math.log(count)
        if "_" in gram:  # bigrams carry phrase signal but shouldn't dominate
            weight *= 0.6
        for probe in range(3):  # multi-probe hashing lowers collision damage
            index, sign = _hash_index(gram, probe, dim)
            vector[index] += sign * weight

    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [v / norm for v in vector]


# ── OpenAI ─────────────────────────────────────────────────────
async def _openai_embed(texts: list[str]) -> list[list[float]]:
    if not settings.openai_api_key:
        raise RuntimeError("EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is empty.")

    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(60)) as client:
        for start in range(0, len(texts), _OPENAI_BATCH):
            batch = [t[:8000] or " " for t in texts[start : start + _OPENAI_BATCH]]
            response = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": settings.openai_embedding_model,
                    "input": batch,
                    "dimensions": settings.embedding_dim,
                },
            )
            response.raise_for_status()
            payload = response.json()
            vectors.extend(item["embedding"] for item in sorted(payload["data"], key=lambda d: d["index"]))
    return vectors


# ── public API ─────────────────────────────────────────────────
async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if settings.embedding_provider.lower() == "openai":
        return await _openai_embed(texts)
    return [local_embed(text) for text in texts]


async def embed_text(text: str) -> list[float]:
    return (await embed_texts([text]))[0]


def to_pgvector(vector: list[float] | None) -> str | None:
    """PostgREST wants pgvector values as a bracketed string literal."""
    if vector is None:
        return None
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"
