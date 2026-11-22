"""Bounded HTTPS GETs for explicitly authorised discovery sources."""

import asyncio
import fnmatch
import ipaddress
import re
import socket
import threading
import time
from urllib.parse import unquote, urljoin, urlsplit

import httpx
from workers.usage import count_request

AGENT = "QwendoDiscovery"
MAX_BYTES = 2 * 1024 * 1024
_rate_lock = threading.Lock()
_next_request = {}


def checked_url(url, hosts):
    if not isinstance(url, str) or len(url) > 8192 or re.search(r"[\x00-\x20\x7f\\]", url):
        raise ValueError("Invalid discovery URL")
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username is not None
            or parsed.port not in (None, 443) or parsed.fragment
            or not re.fullmatch(r"[a-zA-Z0-9.-]+", parsed.hostname or "")):
        raise ValueError("URL outside permitted HTTPS hosts")
    return parsed


def public_address(value):
    ip = ipaddress.ip_address(value)
    return (ip.is_global and not ip.is_multicast and not ip.is_reserved
            and not getattr(ip, "ipv4_mapped", None) and not getattr(ip, "sixtofour", None)
            and not getattr(ip, "teredo", None))


def robots_rules(body):
    groups = []
    agents, rules = [], []
    for line in body.decode("utf-8-sig", errors="strict").splitlines():
        key, _, value = line.partition("#")[0].partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if rules:
                groups.append((agents, rules))
                agents, rules = [], []
            agents.append(value.lower())
        elif agents and key:
            rules.append((key, value))
    groups.append((agents, rules))
    matching = [(len(agent) if agent != "*" else 0, group)
                for names, group in groups for agent in names
                if agent and (agent == "*" or agent in AGENT.lower())]
    specificity = max((size for size, _ in matching), default=-1)
    directives = [item for size, group in matching if size == specificity for item in group]
    patterns, delay = [], 0.5
    for key, value in directives:
        if key == "crawl-delay":
            delay = max(delay, float(value))
        elif key == "request-rate":
            count, seconds = value.split("/")
            delay = max(delay, float(seconds) / int(count))
        elif key in ("allow", "disallow") and value:
            pattern = unquote(value).replace("[", "[[]").replace("?", "[?]")
            pattern = pattern[:-1] if pattern.endswith("$") else pattern + "*"
            patterns.append((len(value.rstrip("$").replace("*", "")), key == "allow",
                             re.compile(fnmatch.translate(pattern))))

    def evaluate(path):
        matches = [(size, allowed) for size, allowed, pattern in patterns
                   if pattern.fullmatch(unquote(path))]
        return max(matches, default=(0, True))[1], delay
    return evaluate


async def pace(host, delay):
    if delay > 30:
        raise ValueError("Publisher crawl delay exceeds request budget")
    with _rate_lock:
        now = time.monotonic()
        when = max(now, _next_request.get(host, 0))
        _next_request[host] = when + delay
    await asyncio.sleep(when - now)


class Fetcher:
    def __init__(self, hosts):
        if not isinstance(hosts, (list, tuple, set)) or not hosts:
            raise ValueError("Discovery needs explicit allowed_hosts")
        self.hosts = frozenset(hosts)
        self.robots = {}
        self.remaining_requests = 64
        self.remaining_bytes = 8 * MAX_BYTES

    async def _request(self, url, headers, cap, delay, *, billable=False):
        parsed = checked_url(url, self.hosts)
        host = parsed.hostname
        if self.remaining_requests <= 0:
            raise ValueError("Discovery request budget exhausted")
        self.remaining_requests -= 1
        await pace(host, delay)
        answers = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        addresses = [info[4][0] for info in answers]
        if not addresses or not all(public_address(ip) for ip in addresses):
            raise ValueError("Non-public discovery address")
        # A fresh pool prevents two virtual hosts sharing a pinned-IP TLS connection.
        pinned = httpx.URL(url).copy_with(host=addresses[0])
        request = httpx.Request(
            "GET", pinned, headers={**headers, "Host": host, "User-Agent": AGENT,
                                    "Accept-Encoding": "identity"},
            extensions={"sni_hostname": host, "timeout": httpx.Timeout(8).as_dict()},
        )
        # Direct transport also keeps provider keys out of the HTTPX client URL log.
        async with httpx.AsyncHTTPTransport(trust_env=False) as transport:
            count_request(billable=billable)
            response = await transport.handle_async_request(request)
            try:
                status = response.status_code
                if status != 200:
                    return status, response.headers, b""
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise ValueError("Unsupported response encoding")
                body = bytearray()
                async for chunk in response.aiter_raw(chunk_size=16384):
                    self.remaining_bytes -= len(chunk)
                    if len(body) + len(chunk) > cap or self.remaining_bytes < 0:
                        raise ValueError("Discovery response exceeds byte budget")
                    body.extend(chunk)
                return status, response.headers, bytes(body)
            finally:
                await response.aclose()

    async def get(self, url, *, api=False, headers=None):
        """API mode is reserved for hardcoded provider endpoints with redirects disabled."""
        async with asyncio.timeout(20):
            for _ in range(4):
                parsed = checked_url(url, self.hosts)
                delay = 0.5
                if not api:
                    host = parsed.hostname
                    if host not in self.robots:
                        status, _, body = await self._request(
                            f"https://{host}/robots.txt", {}, 512000, delay)
                        if status not in (200, 404, 410):
                            raise ValueError(f"Publisher robots unavailable ({status})")
                        if status == 200 and body.lstrip().startswith(b"<"):
                            raise ValueError("Invalid robots response")
                        self.robots[host] = robots_rules(body)
                    wire_path = httpx.URL(url).raw_path.decode("ascii")
                    allowed, delay = self.robots[host](wire_path)
                    if not allowed:
                        raise ValueError("Publisher robots disallow this URL")
                status, response_headers, body = await self._request(
                    url, headers or {}, MAX_BYTES, delay, billable=api)
                if status == 200:
                    return url, body
                if not api and status in (301, 302, 303, 307, 308) and response_headers.get("location"):
                    url = urljoin(url, response_headers["location"])
                    continue
                raise ValueError(f"Discovery upstream returned HTTP {status}")
            raise ValueError("Discovery redirect limit reached")
