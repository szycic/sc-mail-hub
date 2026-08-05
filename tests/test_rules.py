"""Unit and Integration Tests for Auto-Ignore Rules Engine."""

import pytest
from fastapi.testclient import TestClient
from sc_mail_hub.main import app
from conftest import TestingSessionLocal as SessionLocal
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

        # Verify candidate automatically created with IGNORED status & reason tag
        assert cand.status == "IGNORED"
        assert cand.previous_status == "PENDING"
        assert cand.auto_ignored_reason == "Auto-Ignored: Marketing Domain"
    finally:
        db.close()


def test_apply_rules_retroactively():
    """Test applying auto-ignore rules retroactively to existing candidates while preserving CREATED (Notion-synced) candidates."""
    db = SessionLocal()
    try:
        # 1. Create a normal pending email and candidate
        email1 = EmailMessage(
            sender="digest@spam.com",
            recipient="me@sc-mail-hub.local",
            subject="Weekly Spam Digest",
            body_text="Spam text",
            is_processed=False
        )
        db.add(email1)
        db.commit()
        db.refresh(email1)

        cand1 = TaskCandidate(
            email_id=email1.id,
            title="Weekly Spam Digest",
            status="PENDING"
        )
        db.add(cand1)
        db.commit()

        # 2. Create a candidate already synced to Notion (status CREATED, notion_page_id set)
        email2 = EmailMessage(
            sender="digest@spam.com",
            recipient="me@sc-mail-hub.local",
            subject="Synced Spam Digest",
            body_text="Spam text",
            is_processed=True
        )
        db.add(email2)
        db.commit()
        db.refresh(email2)

        cand2 = TaskCandidate(
            email_id=email2.id,
            title="Synced Spam Digest",
            status="CREATED",
            notion_page_id="page_12345"
        )
        db.add(cand2)
        db.commit()

        # 3. Add an active auto-ignore rule matching 'spam.com'
        rule = AutoIgnoreRule(
            name="Spam Domain Filter",
            rule_type="sender_domain",
            pattern="spam.com",
            is_active=True
        )
        db.add(rule)
        db.commit()

        cand1_id = cand1.id
        cand2_id = cand2.id
    finally:
        db.close()

    # 4. Trigger apply rules endpoint
    apply_res = client.post("/api/rules/apply")
    assert apply_res.status_code == 200
    apply_data = apply_res.json()
    assert apply_data["ignored_count"] >= 1

    db2 = SessionLocal()
    try:
        updated_cand1 = db2.query(TaskCandidate).filter(TaskCandidate.id == cand1_id).first()
        updated_cand2 = db2.query(TaskCandidate).filter(TaskCandidate.id == cand2_id).first()

        # Pending candidate should be IGNORED
        assert updated_cand1.status == "IGNORED"
        assert updated_cand1.auto_ignored_reason == "Auto-Ignored: Spam Domain Filter"

        # Notion-synced candidate MUST remain CREATED and not IGNORED
        assert updated_cand2.status == "CREATED"
        assert updated_cand2.notion_page_id == "page_12345"
    finally:
        db2.close()



