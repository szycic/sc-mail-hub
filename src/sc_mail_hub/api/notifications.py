"""Notifications API Router for SC Mail Hub.

Provides REST endpoints for retrieving VAPID public key, managing browser
PushSubscriptions, unsubscribing, and triggering test Web Push notifications.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from sc_mail_hub.database import get_db
from sc_mail_hub.models import PushSubscription
from sc_mail_hub.schemas import PushSubscriptionCreate, PushSubscriptionUnsubscribe
from sc_mail_hub.services.push_service import PushService

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


@router.get("/vapid-public-key")
def get_vapid_public_key(db: Session = Depends(get_db)):
    """Return persistent VAPID public key for browser push subscription."""
    pub_key, _, _ = PushService.get_or_create_vapid_keys(db)
    return {"public_key": pub_key}


@router.post("/subscribe")
def subscribe_push(
    payload: PushSubscriptionCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Register or update a client browser Web Push subscription."""
    user_agent = request.headers.get("user-agent", "")
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()

    if sub:
        sub.p256dh = payload.keys.p256dh
        sub.auth = payload.keys.auth
        sub.user_agent = user_agent
    else:
        sub = PushSubscription(
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=user_agent
        )
        db.add(sub)

    db.commit()
    return {"status": "subscribed", "endpoint": payload.endpoint}


@router.post("/unsubscribe")
def unsubscribe_push(
    payload: PushSubscriptionUnsubscribe,
    db: Session = Depends(get_db)
):
    """Remove a browser Web Push subscription endpoint."""
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    if sub:
        db.delete(sub)
        db.commit()
    return {"status": "unsubscribed"}


@router.post("/test")
def trigger_test_push_notification(db: Session = Depends(get_db)):
    """Dispatch a test Web Push notification to all active client subscriptions."""
    result = PushService.broadcast_push_notification(
        db,
        title="Mail Hub Test Push",
        body="Web Push is active! You can receive notifications even when closed.",
        url="/inbox"
    )
    return {
        "message": "Test push notification dispatched",
        "result": result
    }
