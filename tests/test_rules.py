"""Unit and Integration Tests for Auto-Ignore Rules Engine."""

import pytest
from fastapi.testclient import TestClient
from sc_mail_hub.main import app
from sc_mail_hub.database import SessionLocal
from sc_mail_hub.models import AutoIgnoreRule, EmailMessage, TaskCandidate
from sc_mail_hub.services.rule_service import RuleService
from sc_mail_hub.services.ai_service import AIService

client = TestClient(app)


def test_rule_service_matching():
    """Test unit rule evaluation for sender domain, sender substring, subject keyword, and subject regex."""
    # 1. Sender Domain
    domain_rule = AutoIgnoreRule(
        name="Google Domain",
        rule_type="sender_domain",
        pattern="google.com",
        is_active=True
    )
    assert RuleService.matches_rule(domain_rule, "Google News <no-reply@google.com>", "What's new") is True
    assert RuleService.matches_rule(domain_rule, "no-reply@mail.google.com", "What's new") is True
    assert RuleService.matches_rule(domain_rule, "finance@esnpoland.org", "What's new") is False

    # 2. Sender Contains
    sender_rule = AutoIgnoreRule(
        name="No-Reply Filter",
        rule_type="sender_contains",
        pattern="no-reply@",
        is_active=True
    )
    assert RuleService.matches_rule(sender_rule, "Notifications <no-reply@github.com>", "Alert") is True
    assert RuleService.matches_rule(sender_rule, "support@github.com", "Alert") is False

    # 3. Subject Keyword
    keyword_rule = AutoIgnoreRule(
        name="Newsletter Keyword",
        rule_type="subject_keyword",
        pattern="newsletter",
        is_active=True
    )
    assert RuleService.matches_rule(keyword_rule, "sender@test.com", "Monthly Newsletter Issue #10") is True
    assert RuleService.matches_rule(keyword_rule, "sender@test.com", "Important Task Update") is False

    # 4. Subject Regex
    regex_rule = AutoIgnoreRule(
        name="Alert Regex",
        rule_type="subject_regex",
        pattern=r"^\[ALERT\]",
        is_active=True
    )
    assert RuleService.matches_rule(regex_rule, "sender@test.com", "[ALERT] Server CPU usage high") is True
    assert RuleService.matches_rule(regex_rule, "sender@test.com", "Server [ALERT] CPU usage") is False

    # 5. Inactive Rule
    inactive_rule = AutoIgnoreRule(
        name="Inactive Rule",
        rule_type="sender_domain",
        pattern="google.com",
        is_active=False
    )
    assert RuleService.matches_rule(inactive_rule, "no-reply@google.com", "Test") is False


def test_rules_api_crud():
    """Test REST API CRUD endpoints for auto-ignore rules."""
    # List initial rules
    list_res = client.get("/api/rules")
    assert list_res.status_code == 200

    # Create new rule
    create_payload = {
        "name": "Promotional Newsletter Filter",
        "rule_type": "subject_keyword",
        "pattern": "unsubscribe",
        "is_active": True
    }
    create_res = client.post("/api/rules", json=create_payload)
    assert create_res.status_code == 201
    rule_data = create_res.json()
    rule_id = rule_data["id"]
    assert rule_data["name"] == "Promotional Newsletter Filter"
    assert rule_data["rule_type"] == "subject_keyword"

    # Test rule matching endpoint
    test_match_res = client.post("/api/rules/test", json={"sender": "ads@promo.com", "subject": "Click here to unsubscribe"})
    assert test_match_res.status_code == 200
    test_match_data = test_match_res.json()
    assert test_match_data["matched"] is True
    assert test_match_data["matched_rule"]["id"] == rule_id

    # Test non-matching sample
    test_nomatch_res = client.post("/api/rules/test", json={"sender": "boss@work.com", "subject": "Urgent review needed"})
    assert test_nomatch_res.status_code == 200
    assert test_nomatch_res.json()["matched"] is False

    # Update rule
    update_res = client.put(f"/api/rules/{rule_id}", json={"is_active": False})
    assert update_res.status_code == 200
    assert update_res.json()["is_active"] is False

    # Delete rule
    del_res = client.delete(f"/api/rules/{rule_id}")
    assert del_res.status_code == 200


def test_auto_ignore_on_email_ingestion():
    """Test that incoming emails matching an auto-ignore rule automatically become IGNORED candidates."""
    db = SessionLocal()
    try:
        # Create domain rule for @marketing.com
        rule = AutoIgnoreRule(
            name="Marketing Domain",
            rule_type="sender_domain",
            pattern="marketing.com",
            is_active=True
        )
        db.add(rule)
        db.commit()

        # Ingest marketing email
        email_msg = EmailMessage(
            sender="Deals <info@marketing.com>",
            recipient="me@sc-mail-hub.local",
            subject="Special Summer Discount!",
            body_text="Click here to save 50%",
            is_processed=False
        )
        db.add(email_msg)
        db.commit()
        db.refresh(email_msg)

        # Create candidate via AIService
        cand = AIService.ensure_candidate_from_email(email_msg, db)

        # Verify candidate automatically created with IGNORED status
        assert cand.status == "IGNORED"
        assert cand.previous_status == "PENDING"
    finally:
        db.close()
