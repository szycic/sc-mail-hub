"""Unit & Integration tests for connected email account management:
- Editing account name and custom color
- Drag-and-drop reordering of accounts
- Verifying order and color propagation to admin volume statistics (7-day chart & monthly calendar).
"""

import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sc_mail_hub.main import app
from sc_mail_hub.models import EmailAccount, EmailMessage, TaskCandidate, IngestionStat

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_accounts(db_session):
    db_session.query(TaskCandidate).delete()
    db_session.query(EmailMessage).delete()
    db_session.query(IngestionStat).delete()
    db_session.query(EmailAccount).delete()
    db_session.commit()
    yield
    db_session.query(TaskCandidate).delete()
    db_session.query(EmailMessage).delete()
    db_session.query(IngestionStat).delete()
    db_session.query(EmailAccount).delete()
    db_session.commit()


def test_update_account_name_and_color(db_session):
    acc = EmailAccount(
        name="Old Name",
        provider="gmail",
        email_address="account1@example.com",
        color="#60a5fa",
        order_index=1,
        is_active=True
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)

    # 1. Update name and color via PATCH
    patch_res = client.patch(
        f"/api/accounts/{acc.id}",
        json={"name": "Custom Work Name", "color": "#f43f5e"}
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["name"] == "Custom Work Name"
    assert data["color"] == "#f43f5e"

    db_session.refresh(acc)
    assert acc.name == "Custom Work Name"
    assert acc.color == "#f43f5e"


def test_reorder_accounts(db_session):
    acc1 = EmailAccount(name="Acc 1", provider="imap", email_address="a1@test.com", order_index=0, is_active=True)
    acc2 = EmailAccount(name="Acc 2", provider="imap", email_address="a2@test.com", order_index=1, is_active=True)
    acc3 = EmailAccount(name="Acc 3", provider="imap", email_address="a3@test.com", order_index=2, is_active=True)
    db_session.add_all([acc1, acc2, acc3])
    db_session.commit()
    db_session.refresh(acc1)
    db_session.refresh(acc2)
    db_session.refresh(acc3)

    # Verify initial GET /api/accounts order
    res = client.get("/api/accounts")
    assert res.status_code == 200
    accounts = res.json()
    ids = [a["id"] for a in accounts]
    assert ids == [acc1.id, acc2.id, acc3.id]

    # Reorder to [acc3, acc1, acc2]
    reorder_res = client.put(
        "/api/accounts/reorder",
        json={"account_ids": [acc3.id, acc1.id, acc2.id]}
    )
    assert reorder_res.status_code == 200

    # Verify new order in GET /api/accounts
    res2 = client.get("/api/accounts")
    assert res2.status_code == 200
    accounts2 = res2.json()
    assert [a["id"] for a in accounts2] == [acc3.id, acc1.id, acc2.id]


def test_admin_stats_respect_account_order_and_colors(db_session):
    # Create accounts with specific colors and defined order
    acc_blue = EmailAccount(
        name="Blue Account",
        provider="gmail",
        email_address="blue@test.com",
        color="#3b82f6",
        order_index=0,
        is_active=True
    )
    acc_emerald = EmailAccount(
        name="Emerald Account",
        provider="zoho",
        email_address="emerald@test.com",
        color="#10b981",
        order_index=1,
        is_active=True
    )
    db_session.add_all([acc_blue, acc_emerald])
    db_session.commit()
    db_session.refresh(acc_blue)
    db_session.refresh(acc_emerald)

    # Record stats for today
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    stat1 = IngestionStat(date_str=today_str, hour_utc=10, account_email="blue@test.com", count=5)
    stat2 = IngestionStat(date_str=today_str, hour_utc=11, account_email="emerald@test.com", count=8)
    db_session.add_all([stat1, stat2])
    db_session.commit()

    # Check 7-day sync chart series order and color
    chart_res = client.get("/api/admin/sync-chart-data?tz_offset=0")
    assert chart_res.status_code == 200
    chart_data = chart_res.json()
    series = chart_data["series"]
    assert len(series) == 2
    assert series[0]["account_id"] == "blue@test.com"
    assert series[0]["color"] == "#3b82f6"
    assert series[1]["account_id"] == "emerald@test.com"
    assert series[1]["color"] == "#10b981"

    # Now reorder so Emerald is first
    client.put("/api/accounts/reorder", json={"account_ids": [acc_emerald.id, acc_blue.id]})

    # Check 7-day chart series order after reordering
    chart_res2 = client.get("/api/admin/sync-chart-data?tz_offset=0")
    assert chart_res2.status_code == 200
    series2 = chart_res2.json()["series"]
    assert series2[0]["account_id"] == "emerald@test.com"
    assert series2[0]["color"] == "#10b981"
    assert series2[1]["account_id"] == "blue@test.com"
    assert series2[1]["color"] == "#3b82f6"

    # Check ingestion calendar series order after reordering
    now = datetime.now(timezone.utc)
    cal_res = client.get(f"/api/admin/ingestion-calendar-data?year={now.year}&month={now.month}&tz_offset=0")
    assert cal_res.status_code == 200
    cal_series = cal_res.json()["series"]
    assert cal_series[0]["account_id"] == "emerald@test.com"
    assert cal_series[0]["color"] == "#10b981"
    assert cal_series[1]["account_id"] == "blue@test.com"
    assert cal_series[1]["color"] == "#3b82f6"
