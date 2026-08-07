"""Tests for Web Push Notifications service and endpoints."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from sc_mail_hub.main import app
from sc_mail_hub.models import PushSubscription, SystemSettings
from sc_mail_hub.services.push_service import PushService

client = TestClient(app)


def test_get_vapid_public_key():
    response = client.get("/api/notifications/vapid-public-key")
    assert response.status_code == 200
    data = response.json()
    assert "public_key" in data
    assert len(data["public_key"]) > 20


def test_subscribe_and_unsubscribe():
    endpoint = "https://fcm.googleapis.com/fcm/send/test-subscription-token-123"
    payload = {
        "endpoint": endpoint,
        "keys": {
            "p256dh": "BNcAC3178...",
            "auth": "authSecret123"
        }
    }

    # Subscribe
    res = client.post("/api/notifications/subscribe", json=payload)
    assert res.status_code == 200
    assert res.json()["status"] == "subscribed"

    # Verify duplicate endpoint update
    res_update = client.post("/api/notifications/subscribe", json=payload)
    assert res_update.status_code == 200
    assert res_update.json()["status"] == "subscribed"

    # Unsubscribe
    unsub_payload = {"endpoint": endpoint}
    res_unsub = client.post("/api/notifications/unsubscribe", json=unsub_payload)
    assert res_unsub.status_code == 200
    assert res_unsub.json()["status"] == "unsubscribed"


def test_trigger_test_push_notification():
    res = client.post("/api/notifications/test")
    assert res.status_code == 200
    data = res.json()
    assert data["message"] == "Test push notification dispatched"
    assert "result" in data


def test_push_service_vapid_object_deserialization():
    from sc_mail_hub.database import SessionLocal
    db = SessionLocal()
    try:
        vapid_obj, pub_key, sub = PushService.get_vapid_object(db)
        assert vapid_obj is not None
        assert hasattr(vapid_obj, "private_key")
        assert len(pub_key) > 20
    finally:
        db.close()


@pytest.mark.anyio
async def test_notify_sync_completed_only_pushes_on_increase():
    from unittest.mock import patch
    from sc_mail_hub.api.inbox import notify_sync_completed_async, reset_last_pending_count

    reset_last_pending_count(None)
    with patch("sc_mail_hub.api.inbox.PushService.broadcast_push_notification") as mock_push, \
         patch("sc_mail_hub.api.inbox.compute_inbox_stats") as mock_stats:

        # 1. Baseline sync with 3 pending emails -> no push notification
        mock_stats.return_value = {"counts": {"PENDING": 3}, "last_synced_at": "2026-08-06T00:00:00Z"}
        await notify_sync_completed_async()
        assert mock_push.call_count == 0

        # 2. Subsequent sync with same count (3) -> no push notification
        await notify_sync_completed_async()
        assert mock_push.call_count == 0

        # 3. Sync with decreased count (2) -> no push notification
        mock_stats.return_value = {"counts": {"PENDING": 2}, "last_synced_at": "2026-08-06T00:05:00Z"}
        await notify_sync_completed_async()
        assert mock_push.call_count == 0

        # 4. Sync with increased count (5) -> triggers push notification!
        mock_stats.return_value = {"counts": {"PENDING": 5}, "last_synced_at": "2026-08-06T00:10:00Z"}
        await notify_sync_completed_async()
        assert mock_push.call_count == 1
        assert mock_push.call_args[1]["body"] == "There are 5 pending emails"


@pytest.mark.anyio
async def test_sync_suppresses_intermediate_notifications():
    from unittest.mock import patch
    from sc_mail_hub.api.inbox import (
        start_sync,
        finish_sync_async,
        notify_sync_completed_async,
        reset_last_pending_count,
        is_sync_in_progress,
    )

    reset_last_pending_count(None)
    with patch("sc_mail_hub.api.inbox.PushService.broadcast_push_notification") as mock_push, \
         patch("sc_mail_hub.api.inbox.compute_inbox_stats") as mock_stats:

        # 1. Initial state before sync: 5 pending emails
        mock_stats.return_value = {"counts": {"PENDING": 5}, "last_synced_at": "2026-08-06T00:00:00Z"}
        start_sync()
        assert is_sync_in_progress() is True

        # 2. Intermediate updates as sync progresses (5 -> 9 -> 10 -> 15 -> 21)
        mock_stats.return_value = {"counts": {"PENDING": 9}, "last_synced_at": "2026-08-06T00:01:00Z"}
        await notify_sync_completed_async(is_intermediate=True)

        mock_stats.return_value = {"counts": {"PENDING": 10}, "last_synced_at": "2026-08-06T00:02:00Z"}
        await notify_sync_completed_async(is_intermediate=True)

        mock_stats.return_value = {"counts": {"PENDING": 15}, "last_synced_at": "2026-08-06T00:03:00Z"}
        await notify_sync_completed_async(is_intermediate=True)

        mock_stats.return_value = {"counts": {"PENDING": 21}, "last_synced_at": "2026-08-06T00:04:00Z"}
        await notify_sync_completed_async(is_intermediate=True)

        # Zero notifications should have been sent during sync progress!
        assert mock_push.call_count == 0

        # 3. Sync completes
        await finish_sync_async()
        assert is_sync_in_progress() is False

        # EXACTLY ONE notification dispatched upon sync completion!
        assert mock_push.call_count == 1
        assert mock_push.call_args[1]["body"] == "There are 21 pending emails"


