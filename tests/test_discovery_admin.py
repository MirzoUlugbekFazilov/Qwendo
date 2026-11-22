"""Discovery operations use signed-in identity and server-managed admin grants."""
import unittest
from unittest.mock import AsyncMock

from fastapi import HTTPException

from api.routers.discovery_admin import Submission, public_url, require_operator, submit


class SubmissionTests(unittest.IsolatedAsyncioTestCase):
    def test_private_or_secret_urls(self):
        for url in ("http://events.example.org/e", "https://localhost/", "https://127.0.0.1/",
                    "https://user@events.example.org/e", "https://events.example.org/e?token=x",
                    "https://events.example.org:5000/e"):
            with self.subTest(url=url), self.assertRaises(HTTPException):
                public_url(url)

    def test_role_is_server_managed(self):
        require_operator({"app_metadata": {"qwendo_admin": True}})
        with self.assertRaises(HTTPException):
            require_operator({"user_metadata": {"qwendo_admin": True}})

    async def test_quota_and_identity(self):
        db = AsyncMock()
        db.rpc.return_value = None
        with self.assertRaises(HTTPException) as raised:
            await submit(Submission(url="https://events.example.org/e#tickets"), {"id": "person"}, db)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(db.rpc.await_args.args[1]["p_user"], "person")
        self.assertEqual(db.rpc.await_args.args[1]["p_url"], "https://events.example.org/e")
