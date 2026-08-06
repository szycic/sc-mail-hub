import pytest
from fastapi.testclient import TestClient
from sc_mail_hub.main import app

client = TestClient(app)


def test_system_diagnostics_run():
    """Verify that POST /api/admin/diagnostics/run runs all 5 system checks and returns diagnostic results."""
    response = client.post("/api/admin/diagnostics/run")
    assert response.status_code == 200, response.text
    data = response.json()

    assert "timestamp" in data
    assert "overall_status" in data
    assert data["overall_status"] in ("ok", "warning", "error")
    assert "total_duration_ms" in data
    assert isinstance(data["total_duration_ms"], (int, float))

    results = data.get("results", {})
    assert "imap" in results
    assert "notion" in results
    assert "ai" in results
    assert "websocket" in results
    assert "db_integrity" in results

    # Verify WebSocket check
    assert results["websocket"]["status"] == "success"
    assert "WebSocket broadcast server active" in results["websocket"]["details"]

    # Verify DB integrity check
    assert results["db_integrity"]["status"] == "success"
    assert "PRAGMA quick_check: ok" in results["db_integrity"]["details"]


def test_config_export():
    """Verify that GET /api/admin/config/export returns system settings, field mappings, and auto-ignore rules in JSON payload."""
    response = client.get("/api/admin/config/export")
    assert response.status_code == 200, response.text

    assert "Content-Disposition" in response.headers
    assert "attachment; filename=" in response.headers["Content-Disposition"]

    data = response.json()
    assert data.get("version") == "1.0"
    assert "exported_at" in data
    assert "system_settings" in data
    assert "field_mappings" in data
    assert "auto_ignore_rules" in data

    sys_settings = data["system_settings"]
    assert "imap_sync_enabled" in sys_settings
    assert "ui_auto_refresh_enabled" in sys_settings


def test_selective_config_export():
    """Verify that selective query parameters include/exclude specific sections in exported backup."""
    # Export ONLY auto_ignore_rules
    url = "/api/admin/config/export?include_system_settings=false&include_field_mappings=false&include_auto_ignore_rules=true"
    response = client.get(url)
    assert response.status_code == 200, response.text
    data = response.json()

    assert "auto_ignore_rules" in data
    assert "system_settings" not in data
    assert "field_mappings" not in data


def test_config_import():
    """Verify that POST /api/admin/config/import restores configuration settings, field mappings, and rules."""
    payload = {
        "system_settings": {
            "imap_sync_enabled": False,
            "imap_sync_interval_seconds": 600,
            "ui_auto_refresh_enabled": True,
            "ui_auto_refresh_interval_seconds": 60,
            "auto_purge_synced_enabled": True,
            "purge_synced_days": 14,
            "auto_purge_ignored_enabled": False,
            "purge_ignored_days": 30
        },
        "field_mappings": [
            {
                "task_field": "title",
                "notion_property_name": "Task Name",
                "notion_property_type": "title"
            },
            {
                "task_field": "summary",
                "notion_property_name": "Description",
                "notion_property_type": "rich_text"
            }
        ],
        "auto_ignore_rules": [
            {
                "name": "Custom Test Import Rule",
                "rule_type": "sender_domain",
                "pattern": "testimportdomain.com",
                "is_active": True
            }
        ]
    }

    response = client.post("/api/admin/config/import", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()

    assert data.get("message") == "Configuration imported successfully!"
    imported = data.get("imported", {})
    assert imported.get("system_settings") is True
    assert imported.get("field_mappings_count") == 2
    assert imported.get("auto_ignore_rules_count") == 1

    # Verify settings updated in GET /api/admin/settings
    settings_res = client.get("/api/admin/settings")
    assert settings_res.status_code == 200
    s_data = settings_res.json()
    assert s_data["imap_sync_enabled"] is False
    assert s_data["imap_sync_interval_seconds"] == 600
    assert s_data["auto_purge_synced_enabled"] is True
    assert s_data["purge_synced_days"] == 14

    # Verify rule added in GET /api/rules
    rules_res = client.get("/api/rules")
    assert rules_res.status_code == 200
    r_data = rules_res.json()
    matching = [r for r in r_data if r["pattern"] == "testimportdomain.com"]
    assert len(matching) == 1
    assert matching[0]["name"] == "Custom Test Import Rule"


def test_selective_config_import():
    """Verify that importing ONLY auto-ignore rules updates rules without touching system settings."""
    payload = {
        "auto_ignore_rules": [
            {
                "name": "Only Rules Import Test",
                "rule_type": "subject_keyword",
                "pattern": "onlyruleskeyword",
                "is_active": True
            }
        ]
    }

    response = client.post("/api/admin/config/import", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()

    imported = data.get("imported", {})
    assert imported.get("system_settings") is False
    assert imported.get("field_mappings_count") == 0
    assert imported.get("auto_ignore_rules_count") == 1


def test_auto_ignore_rules_import_deduplication():
    """Verify that importing duplicate auto-ignore rules updates existing entries instead of creating duplicate database records."""
    # Fetch initial count of rules
    initial_rules = client.get("/api/rules").json()
    initial_count = len(initial_rules)

    # Import duplicate payload with same pattern & same name multiple times
    payload = {
        "auto_ignore_rules": [
            {
                "name": "Deduplication Test Rule",
                "rule_type": "sender_domain",
                "pattern": "dedupdomain.com",
                "is_active": True
            },
            {
                "name": "Deduplication Test Rule",
                "rule_type": "sender_domain",
                "pattern": "dedupdomain.com",
                "is_active": True
            },
            {
                "name": "Deduplication Test Rule",
                "rule_type": "sender_domain",
                "pattern": "DEDUPDOMAIN.COM",  # Case insensitive match test
                "is_active": False
            }
        ]
    }

    res1 = client.post("/api/admin/config/import", json=payload)
    assert res1.status_code == 200

    rules_after_first_import = client.get("/api/rules").json()
    dedup_matches = [r for r in rules_after_first_import if r["pattern"].lower() == "dedupdomain.com"]
    # Should exist exactly ONCE in database
    assert len(dedup_matches) == 1
    assert dedup_matches[0]["is_active"] is False

    # Perform second import with the exact same payload again
    res2 = client.post("/api/admin/config/import", json=payload)
    assert res2.status_code == 200

    rules_after_second_import = client.get("/api/rules").json()
    assert len(rules_after_second_import) == initial_count + 1
    dedup_matches_2 = [r for r in rules_after_second_import if r["pattern"].lower() == "dedupdomain.com"]
    assert len(dedup_matches_2) == 1


def test_get_sync_health_stats():
    """Verify that GET /api/admin/sync-health returns live IMAP sync health indicators and excludes old DB messages."""
    from datetime import datetime, timezone, timedelta
    from sc_mail_hub.database import get_db, SessionLocal
    from sc_mail_hub.models import EmailMessage, EmailAccount, SystemSettings
    from sc_mail_hub.services.email_service import EmailService

    # Reset in-memory cumulative stats & persisted daily count for test isolation
    EmailService._last_sync_stats["cumulative_fetched_today"] = 0

    db_gen = app.dependency_overrides.get(get_db, SessionLocal)()
    db = next(db_gen) if hasattr(db_gen, "__next__") else db_gen
    try:
        sys_set = db.query(SystemSettings).first()
        if sys_set:
            sys_set.daily_ingested_count = 0
            db.commit()

        # Create dummy account if none exists
        acc = db.query(EmailAccount).first()
        if not acc:
            acc = EmailAccount(name="Test Account", provider="imap", email_address="test@local.domain")
            db.add(acc)
            db.commit()
            db.refresh(acc)

        # Seed an old email from 5 days ago
        old_msg = EmailMessage(
            account_id=acc.id,
            message_id="old-test-msg@local.domain",
            sender="old@local.domain",
            subject="Old email",
            body_text="Old email content",
            received_at=datetime.now(timezone.utc) - timedelta(days=5)
        )
        db.add(old_msg)

        # Seed a today email
        today_msg = EmailMessage(
            account_id=acc.id,
            message_id="today-test-msg@local.domain",
            sender="today@local.domain",
            subject="Today email",
            body_text="Today email content",
            received_at=datetime.now(timezone.utc)
        )
        db.add(today_msg)
        db.commit()

        response = client.get("/api/admin/sync-health")
        assert response.status_code == 200, response.text
        data = response.json()

        assert "last_sync_duration_seconds" in data
        assert "emails_fetched_today" in data
        assert "status" in data
        assert data["status"] in ("healthy", "error")

        # Today count must strictly count emails received today (1), ignoring old messages (1 old + 1 today = 2 total, today count = 1)
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).replace(tzinfo=None)
        today_db_count = db.query(EmailMessage).filter(
            EmailMessage.received_at >= today_start
        ).count()
        assert data["emails_fetched_today"] == today_db_count
        assert today_db_count == 1

        # Clean up seeded test messages and dummy account
        db.delete(old_msg)
        db.delete(today_msg)
        if acc and acc.email_address == "test@local.domain":
            db.delete(acc)
        db.commit()
    finally:
        if hasattr(db_gen, "close"):
            db_gen.close()
        else:
            db.close()


def test_get_sync_chart_data():
    """Verify that GET /api/admin/sync-chart-data returns 7-day ingestion series per account."""
    response = client.get("/api/admin/sync-chart-data")
    assert response.status_code == 200, response.text
    data = response.json()

    assert "days" in data
    assert len(data["days"]) == 7
    assert "series" in data
    assert isinstance(data["series"], list)


