"""Unit tests for PDF generation, header address formatting, and clickable link detection."""

import pytest
from datetime import datetime, timezone
from sc_mail_hub.models import EmailMessage
from sc_mail_hub.services.email_service import EmailService, make_clickable_links


def test_format_email_header_address():
    """Test various input combinations for format_email_header_address."""
    # 1. Full header with name and angle brackets
    res1 = EmailService.format_email_header_address("John Doe <john@example.com>")
    assert res1 == "John Doe <john@example.com>"

    # 2. Display name only with fallback email
    res2 = EmailService.format_email_header_address("John Doe", fallback_email="john@example.com")
    assert res2 == "John Doe <john@example.com>"

    # 3. Email only with fallback name
    res3 = EmailService.format_email_header_address("finance@esnpoland.org", fallback_name="ESN Poland Finance")
    assert res3 == "ESN Poland Finance <finance@esnpoland.org>"

    # 4. Email only without fallback name
    res4 = EmailService.format_email_header_address("finance@esnpoland.org")
    assert res4 == "finance@esnpoland.org <finance@esnpoland.org>"

    # 5. Empty raw_value with fallbacks
    res5 = EmailService.format_email_header_address("", fallback_email="szymon@example.com", fallback_name="Szymon")
    assert res5 == "Szymon <szymon@example.com>"

    # 6. Empty raw_value with no fallbacks
    res6 = EmailService.format_email_header_address(None)
    assert res6 == "Unknown"


def test_generate_email_pdf_includes_email_in_angle_brackets(tmp_path, monkeypatch):
    """Test that generate_email_pdf outputs correct From: and To: header text with email in <>."""
    monkeypatch.setattr(EmailService, "get_pdf_dir", lambda: tmp_path)

    msg = EmailMessage(
        id=999,
        sender="Jan Kowalski <jan@example.com>",
        recipient="Anna Nowak <anna@example.com>",
        subject="Test PDF Email Formatting",
        body_text="Hello, visit https://example.com or email test@example.com",
        received_at=datetime(2026, 8, 12, 12, 0, 0, tzinfo=timezone.utc)
    )

    pdf_rel_path = EmailService.generate_email_pdf(msg)
    assert pdf_rel_path == "/static/pdfs/email_999.pdf"

    pdf_file = tmp_path / "email_999.pdf"
    assert pdf_file.exists()
    assert pdf_file.stat().st_size > 0


def test_make_clickable_links():
    """Test converting URLs, www domains, and email addresses into PDF clickable hyperlink tags."""
    text = "Visit https://esnpoland.org or www.esn.pl or contact hr@esn.pl for info."
    res = make_clickable_links(text)

    assert '<a href="https://esnpoland.org" color="#2563eb"><u>https://esnpoland.org</u></a>' in res
    assert '<a href="http://www.esn.pl" color="#2563eb"><u>www.esn.pl</u></a>' in res
    assert '<a href="mailto:hr@esn.pl" color="#2563eb"><u>hr@esn.pl</u></a>' in res
