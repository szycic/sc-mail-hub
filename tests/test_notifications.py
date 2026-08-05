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
