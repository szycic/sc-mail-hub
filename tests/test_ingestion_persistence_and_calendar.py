"""Unit & Integration tests for persistent email ingestion tracking and the monthly ingestion calendar."""

from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from sc_mail_hub.main import app
from sc_mail_hub.models import (
    EmailAccount, EmailMessage, TaskCandidate, IngestionStat, SystemSettings
)
from sc_mail_hub.services.email_service import EmailService

client = TestClient(app)



def test_ingestion_stat_recording_and_persistence(db_session):
    """Verify that IngestionStat records hourly counts and survives candidate/message purges."""
    # 1. Create an email account
    account = EmailAccount(
        name="Test Mailbox",
        provider="gmail",
        email_address="test@example.com",
        is_active=True
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    # 2. Record multiple email ingestions
    now = datetime.now(timezone.utc)
    EmailService.record_ingestion(
        db=db_session,
        account_email=account.email_address,
        received_at=now,
        account_id=account.id,
        count=3
    )
    db_session.commit()

    date_str = now.strftime("%Y-%m-%d")
    hour_utc = now.hour

    stat = db_session.query(IngestionStat).filter(
        IngestionStat.date_str == date_str,
        IngestionStat.hour_utc == hour_utc,
        IngestionStat.account_email == account.email_address
    ).first()

    assert stat is not None
    assert stat.count == 3
    assert stat.account_id == account.id

    # 3. Add more count to the same hour bucket
    EmailService.record_ingestion(
        db=db_session,
        account_email=account.email_address,
        received_at=now,
        account_id=account.id,
        count=2
    )
    db_session.commit()
    db_session.refresh(stat)
    assert stat.count == 5


def test_batch_ingestion_in_same_transaction_no_conflict(db_session):
    """Verify that multiple record_ingestion calls in the same transaction for the same hour do not raise UNIQUE constraint errors."""
    account_email = "batch_test@example.com"
    now = datetime(2026, 11, 8, 15, 30, 0, tzinfo=timezone.utc)

    # Call record_ingestion 5 times in the same transaction without intermediate commits
    for _ in range(5):
        EmailService.record_ingestion(
            db=db_session,
            account_email=account_email,
            received_at=now,
            account_id=1,
            count=1
        )

    # Commit should succeed cleanly without UNIQUE constraint failure
    db_session.commit()

    stat = db_session.query(IngestionStat).filter_by(
        date_str="2026-11-08",
        hour_utc=15,
        account_email=account_email
    ).first()

    assert stat is not None
    assert stat.count == 5



def test_purge_ignored_preserves_chart_and_stats(db_session):
    """Verify that purging ignored candidates deletes raw messages but preserves 7-day chart counts."""
    # Ensure system settings exist
    sys_set = db_session.query(SystemSettings).first()
    if not sys_set:
        sys_set = SystemSettings(imap_sync_enabled=True, auto_purge_ignored_enabled=True, purge_ignored_days=1)
        db_session.add(sys_set)
        db_session.commit()

    # Create account
    account = EmailAccount(
        name="Work Account",
        provider="zoho",
        email_address="work@example.com",
        is_active=True
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    now = datetime.now(timezone.utc)
    old_time = now - timedelta(days=2)

    # Create raw email and candidate
    email_msg = EmailMessage(
        account_id=account.id,
        account_email=account.email_address,
        message_id="purge-test-msg-001@example.com",
        sender="newsletter@spam.com",
        recipient=account.email_address,
        subject="Ignore Me",
        body_text="Spam content",
        received_at=old_time,
        is_processed=True
    )
    db_session.add(email_msg)
    db_session.commit()
    db_session.refresh(email_msg)

    candidate = TaskCandidate(
        email_id=email_msg.id,
        title="Ignore Me",
        status="IGNORED",
        created_at=old_time,
        updated_at=old_time
    )
    db_session.add(candidate)

    # Record telemetry
    EmailService.record_ingestion(
        db=db_session,
        account_email=account.email_address,
        received_at=old_time,
        account_id=account.id,
        count=1
    )
    db_session.commit()

    # Pre-purge chart check
    res_before = client.get("/api/admin/sync-chart-data?tz_offset=0")
    assert res_before.status_code == 200
    data_before = res_before.json()
    work_series_before = next(s for s in data_before["series"] if s["account_id"] == "work@example.com")
    total_before = sum(work_series_before["counts"])
    assert total_before >= 1

    cand_id = candidate.id
    msg_id = email_msg.id

    # Execute purge via danger endpoint
    res_purge = client.post("/api/admin/danger/purge-ignored")
    assert res_purge.status_code == 200

    # Verify EmailMessage and TaskCandidate are deleted
    assert db_session.query(TaskCandidate).filter(TaskCandidate.id == cand_id).first() is None
    assert db_session.query(EmailMessage).filter(EmailMessage.id == msg_id).first() is None

    # Verify IngestionStat is STILL intact!
    date_str = old_time.strftime("%Y-%m-%d")
    hour_utc = old_time.hour
    stat_after = db_session.query(IngestionStat).filter(
        IngestionStat.date_str == date_str,
        IngestionStat.hour_utc == hour_utc,
        IngestionStat.account_email == account.email_address
    ).first()
    assert stat_after is not None
    assert stat_after.count >= 1

    # Post-purge chart check: Chart still shows the ingested email!
    res_after = client.get("/api/admin/sync-chart-data?tz_offset=0")
    assert res_after.status_code == 200
    data_after = res_after.json()
    work_series_after = next(s for s in data_after["series"] if s["account_id"] == "work@example.com")
    total_after = sum(work_series_after["counts"])
    assert total_after == total_before


def test_ingestion_calendar_data_api(db_session):
    """Test the monthly calendar endpoint returns accurate grid metrics and per-account breakdowns."""
    # Create test accounts
    acc1 = EmailAccount(name="Personal", provider="gmail", email_address="p@test.com", is_active=True)
    acc2 = EmailAccount(name="Work", provider="imap", email_address="w@test.com", is_active=True)
    db_session.add_all([acc1, acc2])
    db_session.commit()

    target_year = 2025
    target_month = 5

    # Day 1: 5 emails for p@test.com
    dt1 = datetime(2025, 5, 1, 10, 0, 0, tzinfo=timezone.utc)
    EmailService.record_ingestion(db_session, "p@test.com", dt1, count=5)

    # Day 1: 3 emails for w@test.com
    EmailService.record_ingestion(db_session, "w@test.com", dt1, count=3)

    # Day 15: 12 emails for w@test.com
    dt2 = datetime(2025, 5, 15, 14, 0, 0, tzinfo=timezone.utc)
    EmailService.record_ingestion(db_session, "w@test.com", dt2, count=12)

    db_session.commit()

    res = client.get(f"/api/admin/ingestion-calendar-data?year={target_year}&month={target_month}&tz_offset=0")
    assert res.status_code == 200
    data = res.json()

    assert data["year"] == 2025
    assert data["month"] == 5
    assert data["month_name"] == "May 2025"
    assert data["days_in_month"] == 31
    assert data["first_weekday"] == 3  # May 1 2025 is Thursday (3)

    # Check Day 1
    day1 = data["daily_counts"]["2025-05-01"]
    assert day1["total"] == 8
    assert day1["by_account"]["p@test.com"] == 5
    assert day1["by_account"]["w@test.com"] == 3
    assert day1["peak_hour"] is not None
    assert day1["peak_hour"]["hour"] == 10
    assert day1["peak_hour"]["count"] == 8

    # Check Day 15
    day15 = data["daily_counts"]["2025-05-15"]
    assert day15["total"] == 12
    assert day15["by_account"]["w@test.com"] == 12
    assert day15["peak_hour"] is not None
    assert day15["peak_hour"]["hour"] == 14
    assert day15["peak_hour"]["count"] == 12

    # Check empty day
    day2 = data["daily_counts"]["2025-05-02"]
    assert day2["total"] == 0
    assert len(day2["by_account"]) == 0
    assert day2["peak_hour"] is None

    # Summary metrics
    assert data["month_total"] == 20
    assert data["daily_average"] == round(20 / 31, 1)
    assert data["peak_day"]["date"] == "2025-05-15"
    assert data["peak_day"]["count"] == 12

    # Available months list contains 2025-05
    assert "2025-05" in data["available_months"]


def test_database_backup_and_integrity_endpoints(db_session, tmp_path):
    """Test SQLite database integrity check and on-demand rolling backup endpoint."""
    # 1. Test db-health endpoint
    res = client.get("/api/admin/db-health")
    assert res.status_code == 200
    health_data = res.json()
    assert health_data["is_healthy"] is True
    assert health_data["status"] == "healthy"
    assert "size_mb" in health_data

    # 2. Test sync-health includes db_health
    res_sync = client.get("/api/admin/sync-health?tz_offset=0")
    assert res_sync.status_code == 200
    sync_data = res_sync.json()
    assert "db_health" in sync_data
    assert sync_data["db_health"]["is_healthy"] is True

    # 3. Test on-demand database backup
    res_backup = client.post("/api/admin/database/backup")
    assert res_backup.status_code == 200
    backup_data = res_backup.json()
    assert backup_data["success"] is True
    assert backup_data["filename"].startswith("sc_mail_hub_")
    assert backup_data["filename"].endswith(".db")
    assert backup_data["size_mb"] >= 0

    # 4. Re-check db-health to ensure total_backups reflects newly created backup
    res2 = client.get("/api/admin/db-health")
    assert res2.status_code == 200
    h2 = res2.json()
    assert h2["total_backups"] >= 1
    assert h2["last_backup"] is not None
    assert h2["last_backup"]["filename"] == backup_data["filename"]
