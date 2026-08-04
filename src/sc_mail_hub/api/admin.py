"""Admin System Settings REST API Endpoint Router for SC Mail Hub.

Provides endpoints to view and update system-wide administrative settings such as
auto-refresh toggles and background email sync polling intervals.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from sc_mail_hub.database import get_db
from sc_mail_hub.models import SystemSettings
from sc_mail_hub.schemas import SystemSettingsOut, SystemSettingsUpdate

router = APIRouter(prefix="/api/admin", tags=["Admin Settings"])


def get_or_create_system_settings(db: Session) -> SystemSettings:
    sys_set = db.query(SystemSettings).first()
    if not sys_set:
        sys_set = SystemSettings(
            imap_sync_enabled=True,
            imap_sync_interval_seconds=300,
            ui_auto_refresh_enabled=True,
            ui_auto_refresh_interval_seconds=30,
            auto_purge_synced_enabled=False,
            purge_synced_days=30,
            auto_purge_ignored_enabled=False,
            purge_ignored_days=30
        )
        db.add(sys_set)
        db.commit()
        db.refresh(sys_set)
    return sys_set


@router.get("/settings", response_model=SystemSettingsOut)
def get_admin_settings(db: Session = Depends(get_db)):
    """Fetch current system administrative settings."""
    return get_or_create_system_settings(db)


@router.put("/settings", response_model=SystemSettingsOut)
def update_admin_settings(payload: SystemSettingsUpdate, db: Session = Depends(get_db)):
    """Update system administrative settings (IMAP email sync, UI auto-refresh, and auto-purge retention)."""
    sys_set = get_or_create_system_settings(db)

    if payload.imap_sync_enabled is not None:
        sys_set.imap_sync_enabled = payload.imap_sync_enabled

    if payload.imap_sync_interval_seconds is not None:
        sys_set.imap_sync_interval_seconds = payload.imap_sync_interval_seconds

    if payload.ui_auto_refresh_enabled is not None:
        sys_set.ui_auto_refresh_enabled = payload.ui_auto_refresh_enabled

    if payload.ui_auto_refresh_interval_seconds is not None:
        sys_set.ui_auto_refresh_interval_seconds = payload.ui_auto_refresh_interval_seconds

    if payload.auto_purge_synced_enabled is not None:
        sys_set.auto_purge_synced_enabled = payload.auto_purge_synced_enabled

    if payload.purge_synced_days is not None:
        sys_set.purge_synced_days = payload.purge_synced_days

    if payload.auto_purge_ignored_enabled is not None:
        sys_set.auto_purge_ignored_enabled = payload.auto_purge_ignored_enabled

    if payload.purge_ignored_days is not None:
        sys_set.purge_ignored_days = payload.purge_ignored_days

    db.commit()
    db.refresh(sys_set)

    if payload.imap_sync_enabled is not None or payload.imap_sync_interval_seconds is not None:
        try:
            from sc_mail_hub.main import trigger_immediate_email_sync
            trigger_immediate_email_sync()
        except Exception as err:
            pass

    return sys_set
