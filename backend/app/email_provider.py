"""Replaceable email delivery adapter. Credentials stay server-side."""

from __future__ import annotations

import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any, Protocol

from .config import get_settings


@dataclass
class SendResult:
    status: str  # provider_accepted | failed | not_configured | unknown
    provider: str
    message_id: str | None = None
    error: str | None = None


class EmailProvider(Protocol):
    def send(
        self,
        *,
        to: list[str],
        subject: str,
        text_body: str,
        html_body: str | None = None,
        attachments: list[tuple[str, bytes, str]] | None = None,
    ) -> SendResult: ...


class NullEmailProvider:
    def send(
        self,
        *,
        to: list[str],
        subject: str,
        text_body: str,
        html_body: str | None = None,
        attachments: list[tuple[str, bytes, str]] | None = None,
    ) -> SendResult:
        return SendResult(
            status="not_configured",
            provider="null",
            error="Email not configured. Set EMAIL_PROVIDER and related environment variables.",
        )


class SMTPEmailProvider:
    def __init__(self) -> None:
        settings = get_settings()
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.username = settings.smtp_username
        self.password = settings.smtp_password
        self.from_addr = settings.email_from
        self.use_tls = settings.smtp_use_tls

    def send(
        self,
        *,
        to: list[str],
        subject: str,
        text_body: str,
        html_body: str | None = None,
        attachments: list[tuple[str, bytes, str]] | None = None,
    ) -> SendResult:
        if not self.host or not self.from_addr:
            return SendResult(
                status="not_configured",
                provider="smtp",
                error="SMTP host or EMAIL_FROM missing",
            )
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = self.from_addr
        message["To"] = ", ".join(to)
        message.set_content(text_body)
        if html_body:
            message.add_alternative(html_body, subtype="html")
        for filename, content, mime in attachments or []:
            maintype, _, subtype = mime.partition("/")
            message.add_attachment(
                content,
                maintype=maintype or "application",
                subtype=subtype or "octet-stream",
                filename=filename,
            )
        message_id = f"<{uuid.uuid4()}@{self.host}>"
        message["Message-ID"] = message_id
        try:
            if self.use_tls:
                context = ssl.create_default_context()
                with smtplib.SMTP(self.host, self.port, timeout=30) as server:
                    server.starttls(context=context)
                    if self.username and self.password:
                        server.login(self.username, self.password)
                    server.send_message(message)
            else:
                with smtplib.SMTP(self.host, self.port, timeout=30) as server:
                    if self.username and self.password:
                        server.login(self.username, self.password)
                    server.send_message(message)
            return SendResult(
                status="provider_accepted",
                provider="smtp",
                message_id=message_id,
            )
        except smtplib.SMTPException as exc:
            return SendResult(status="failed", provider="smtp", error=str(exc)[:500])
        except OSError as exc:
            # Timeout / network ambiguity
            return SendResult(
                status="unknown",
                provider="smtp",
                message_id=message_id,
                error=f"Delivery unknown after transport error: {exc}"[:500],
            )


def get_email_provider() -> EmailProvider:
    settings = get_settings()
    provider = (settings.email_provider or "none").lower()
    if provider in ("", "none", "null", "disabled"):
        return NullEmailProvider()
    if provider == "smtp":
        return SMTPEmailProvider()
    return NullEmailProvider()


def email_configured() -> dict[str, Any]:
    settings = get_settings()
    provider = (settings.email_provider or "none").lower()
    if provider in ("", "none", "null", "disabled"):
        return {
            "configured": False,
            "status": "not_configured",
            "status_label": "Not configured",
            "provider": "none",
            "from_address": None,
            "message": "Email not configured. Analysis, Dashboard and downloads still work.",
        }
    if provider == "smtp":
        missing = []
        if not settings.smtp_host:
            missing.append("SMTP_HOST")
        if not settings.email_from:
            missing.append("EMAIL_FROM")
        if missing:
            return {
                "configured": False,
                "status": "connection_error",
                "status_label": "Connection error",
                "provider": "smtp",
                "from_address": settings.email_from,
                "message": f"SMTP incomplete — missing {', '.join(missing)}.",
            }
        return {
            "configured": True,
            "status": "connected",
            "status_label": "Connected",
            "provider": "smtp",
            "from_address": settings.email_from,
            "message": None,
        }
    return {
        "configured": False,
        "status": "connection_error",
        "status_label": "Connection error",
        "provider": provider,
        "from_address": None,
        "message": f"Unknown EMAIL_PROVIDER '{provider}'.",
    }
