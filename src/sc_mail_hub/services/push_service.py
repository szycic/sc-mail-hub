"""Web Push Notification Service for SC Mail Hub.

Manages VAPID keypair generation and persistence in SystemSettings DB table,
converts public keys for browser subscription, delivers encrypted Web Push notifications
via pywebpush, and cleans up expired/stale push subscriptions.
"""

import json
import logging
import base64
from typing import Dict, Any, Tuple
from sqlalchemy.orm import Session
from cryptography.hazmat.primitives import serialization

from pywebpush import webpush, WebPushException, Vapid
from sc_mail_hub.models import SystemSettings, PushSubscription

logger = logging.getLogger("sc_mail_hub.services.push_service")


class PushService:
    @staticmethod
    def get_or_create_vapid_keys(db: Session) -> Tuple[str, str, str]:
        """Retrieve existing VAPID keypair from DB, or auto-generate persistent keys if absent."""
        sys_set = db.query(SystemSettings).first()
        if not sys_set:
            sys_set = SystemSettings(
                imap_sync_enabled=True,
                imap_sync_interval_seconds=300,
                ui_auto_refresh_enabled=True,
                ui_auto_refresh_interval_seconds=30
            )
            db.add(sys_set)

        if not sys_set.vapid_private_key or not sys_set.vapid_public_key:
            logger.info("Generating new persistent VAPID keypair for Web Push notifications...")
            vapid = Vapid()
            vapid.generate_keys()

            priv_pem = vapid.private_pem().decode("utf-8")
            pub_bytes = vapid.public_key.public_bytes(
                encoding=serialization.Encoding.X962,
                format=serialization.PublicFormat.UncompressedPoint
            )
            pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("utf-8")

            sys_set.vapid_private_key = priv_pem
            sys_set.vapid_public_key = pub_b64
            if not sys_set.vapid_claims_sub:
                sys_set.vapid_claims_sub = "mailto:admin@sc-mail-hub.local"

            db.commit()
            db.refresh(sys_set)

        return (
            sys_set.vapid_public_key,
            sys_set.vapid_private_key,
            sys_set.vapid_claims_sub or "mailto:admin@sc-mail-hub.local"
        )

    @staticmethod
    def get_vapid_object(db: Session) -> Tuple[Vapid, str, str]:
        """Retrieve or generate Vapid instance, public key string, and claims_sub."""
        pub_key, priv_key_pem, claims_sub = PushService.get_or_create_vapid_keys(db)
        try:
            vapid_obj = Vapid.from_pem(priv_key_pem.encode("utf-8"))
            return vapid_obj, pub_key, claims_sub
        except Exception as e:
            logger.warning(f"Existing VAPID key in DB failed to parse ({e}). Re-generating keypair...")
            sys_set = db.query(SystemSettings).first()
            if sys_set:
                sys_set.vapid_private_key = None
                sys_set.vapid_public_key = None
                db.commit()
            pub_key, priv_key_pem, claims_sub = PushService.get_or_create_vapid_keys(db)
            vapid_obj = Vapid.from_pem(priv_key_pem.encode("utf-8"))
            return vapid_obj, pub_key, claims_sub

    @staticmethod
    def send_push_notification(db: Session, subscription: PushSubscription, payload: Dict[str, Any]) -> bool:
        """Deliver encrypted Web Push notification payload to a single registered client subscription endpoint."""
        vapid_obj, pub_key, claims_sub = PushService.get_vapid_object(db)

        subscription_info = {
            "endpoint": subscription.endpoint,
            "keys": {
                "p256dh": subscription.p256dh,
                "auth": subscription.auth
            }
        }

        try:
            webpush(
                subscription_info=subscription_info,
                data=json.dumps(payload),
                vapid_private_key=vapid_obj,
                vapid_claims={"sub": claims_sub}
            )
            logger.info(f"Successfully sent Web Push notification to endpoint: {subscription.endpoint[:40]}...")
            return True
        except WebPushException as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            logger.warning(f"WebPush error (HTTP {status_code}) for endpoint {subscription.endpoint[:40]}: {exc}")
            # If endpoint is invalid, expired, or unsubscribed (404 Not Found / 410 Gone), remove subscription from DB
            if status_code in (404, 410):
                logger.info(f"Removing expired/invalid subscription endpoint from database: {subscription.endpoint[:40]}...")
                db.delete(subscription)
                db.commit()
            return False
        except Exception as exc:
            logger.error(f"Unexpected WebPush exception for endpoint {subscription.endpoint[:40]}: {exc}")
            return False

    @staticmethod
    def broadcast_push_notification(db: Session, title: str, body: str, url: str = "/inbox") -> Dict[str, int]:
        """Broadcast Web Push notification to all active client subscriptions."""
        subscriptions = db.query(PushSubscription).all()
        if not subscriptions:
            logger.debug("No registered push subscriptions found for Web Push broadcast.")
            return {"total": 0, "successful": 0, "failed": 0, "purged": 0}

        payload = {
            "title": title,
            "body": body,
            "icon": "/static/assets/favicon-32x32.png",
            "badge": "/static/assets/favicon-16x16.png",
            "url": url
        }

        successful = 0
        failed = 0
        initial_count = len(subscriptions)

        for sub in subscriptions:
            ok = PushService.send_push_notification(db, sub, payload)
            if ok:
                successful += 1
            else:
                failed += 1

        final_count = db.query(PushSubscription).count()
        purged = initial_count - final_count

        return {
            "total": initial_count,
            "successful": successful,
            "failed": failed,
            "purged": purged
        }
