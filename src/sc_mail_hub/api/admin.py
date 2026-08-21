"""Admin System Settings REST API Endpoint Router for SC Mail Hub.

Provides endpoints to view and update system-wide administrative settings such as
auto-refresh toggles and background email sync polling intervals.
"""

from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from sc_mail_hub.database import get_db
from sc_mail_hub.models import SystemSettings
from sc_mail_hub.schemas import SystemSettingsOut, SystemSettingsUpdate, SystemDiagnosticsResponse, ConfigImportRequest

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


@router.get("/sync-health")
def get_sync_health_stats(tz_offset: int = 0, db: Session = Depends(get_db)):
    """Fetch live IMAP sync health metrics and status indicators."""
    from sc_mail_hub.services.email_service import EmailService
    return EmailService.get_sync_health_stats(db, tz_offset=tz_offset)


@router.get("/sync-chart-data")
def get_sync_chart_data(tz_offset: int = 0, db: Session = Depends(get_db)):
    """Fetch 7-day email ingestion statistics broken down by connected IMAP email accounts in user local time."""
    from datetime import datetime, timedelta, timezone
    from sc_mail_hub.models import EmailAccount, EmailMessage

    now_utc = datetime.now(timezone.utc)
    now_local = now_utc - timedelta(minutes=tz_offset)
    today_local_date = now_local.date()

    days = [today_local_date - timedelta(days=i) for i in range(6, -1, -1)]
    day_labels = [d.strftime("%b %d") for d in days]
    day_iso_strs = [d.strftime("%Y-%m-%d") for d in days]

    active_accounts = db.query(EmailAccount).all()
    active_emails = {acc.email_address: acc.name for acc in active_accounts}

    start_local_dt = datetime.combine(days[0], datetime.min.time())
    start_utc_dt = start_local_dt + timedelta(minutes=tz_offset)

    messages = db.query(EmailMessage.account_email, EmailMessage.received_at).filter(
        EmailMessage.received_at >= start_utc_dt
    ).all()

    account_data: Dict[str, Dict[str, int]] = {}
    account_map: Dict[str, str] = {}

    for email_addr, name in active_emails.items():
        account_data[email_addr] = {d_str: 0 for d_str in day_iso_strs}
        account_map[email_addr] = f"{name} ({email_addr})" if (name and name != email_addr) else email_addr

    for acc_email, r_at in messages:
        if not r_at:
            continue
        if r_at.tzinfo is None:
            r_at_utc = r_at.replace(tzinfo=timezone.utc)
        else:
            r_at_utc = r_at
        r_at_local = r_at_utc - timedelta(minutes=tz_offset)
        d_str = r_at_local.strftime("%Y-%m-%d")
        if d_str in day_iso_strs:
            target_key = acc_email if acc_email else "System"
            if target_key not in account_data:
                account_data[target_key] = {ds: 0 for ds in day_iso_strs}
                if target_key == "System":
                    account_map["System"] = "System"
                else:
                    account_map[target_key] = f"{target_key} (Disconnected)"

            account_data[target_key][d_str] = account_data[target_key].get(d_str, 0) + 1

    series = []
    colors = ["#60a5fa", "#34d399", "#a78bfa", "#fbbf24", "#f472b6", "#38bdf8"]

    active_keys = [k for k in account_data if sum(account_data[k].values()) > 0 or k in active_emails]
    if "System" in active_keys and sum(account_data["System"].values()) == 0 and len(active_keys) > 1:
        active_keys.remove("System")

    for idx, acc_key in enumerate(active_keys):
        counts = [account_data[acc_key][d_str] for d_str in day_iso_strs]
        series.append({
            "account_id": acc_key,
            "account_name": account_map.get(acc_key, acc_key),
            "color": colors[idx % len(colors)],
            "counts": counts
        })

    return {
        "days": day_labels,
        "series": series
    }



@router.post("/diagnostics/run", response_model=SystemDiagnosticsResponse)
def run_system_diagnostics(db: Session = Depends(get_db)):
    """Run automated health & connection diagnostics across IMAP, Notion, AI, WebSocket, and DB integrity."""
    import time
    from datetime import datetime, timezone
    from sqlalchemy import text
    from sc_mail_hub.models import EmailAccount, NotionConfig, AISettings, TaskCandidate, EmailMessage, AutoIgnoreRule
    from sc_mail_hub.services.email_service import EmailService
    from sc_mail_hub.services.notion_service import NotionService
    from sc_mail_hub.services.ai_service import AIService
    from sc_mail_hub.api.inbox import sync_ws_manager
    from sc_mail_hub.schemas import SystemDiagnosticsResponse, DiagnosticCheckResult

    start_total = time.perf_counter()
    results = {}
    has_failed = False
    has_warning = False

    # 1. IMAP Servers Check
    t0 = time.perf_counter()
    active_accounts = db.query(EmailAccount).filter(EmailAccount.is_active == True).all()
    if not active_accounts:
        results["imap"] = DiagnosticCheckResult(
            name="IMAP Mail Servers",
            status="warning",
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            details="No active IMAP email accounts configured."
        )
        has_warning = True
    else:
        passed_accounts = []
        failed_accounts = []
        for acc in active_accounts:
            res = EmailService.test_imap_connection(str(acc.credentials_json or ""))
            if res.get("success"):
                passed_accounts.append(acc.email_address)
            else:
                failed_accounts.append(f"{acc.email_address}: {res.get('error', 'Connection failed')}")

        t_imap = round((time.perf_counter() - t0) * 1000, 2)
        if failed_accounts:
            results["imap"] = DiagnosticCheckResult(
                name="IMAP Mail Servers",
                status="failed",
                latency_ms=t_imap,
                details=f"IMAP check failed for {len(failed_accounts)} account(s). Details: {'; '.join(failed_accounts)}"
            )
            has_failed = True
        else:
            results["imap"] = DiagnosticCheckResult(
                name="IMAP Mail Servers",
                status="success",
                latency_ms=t_imap,
                details=f"Connected successfully to {len(passed_accounts)} IMAP account(s) ({', '.join(passed_accounts)})."
            )

    # 2. Notion API Authentication Check
    t0 = time.perf_counter()
    notion_cfg = db.query(NotionConfig).first()
    if not notion_cfg or not notion_cfg.api_token or not notion_cfg.database_id:
        results["notion"] = DiagnosticCheckResult(
            name="Notion API Authentication",
            status="warning",
            latency_ms=round((time.perf_counter() - t0) * 1000, 2),
            details="Notion API token or Target Database ID is not configured."
        )
        has_warning = True
    else:
        notion_res = NotionService.fetch_database_schema(str(notion_cfg.api_token), str(notion_cfg.database_id))
        t_notion = round((time.perf_counter() - t0) * 1000, 2)
        if notion_res.get("success"):
            db_title = notion_res.get("database_title", notion_cfg.database_title or "Target Database")
            results["notion"] = DiagnosticCheckResult(
                name="Notion API Authentication",
                status="success",
                latency_ms=t_notion,
                details=f"Notion API authenticated successfully (Connected to '{db_title}')."
            )
        else:
            results["notion"] = DiagnosticCheckResult(
                name="Notion API Authentication",
                status="failed",
                latency_ms=t_notion,
                details=f"Notion API authentication failed: {notion_res.get('error', 'Invalid API key or Database ID')}"
            )
            has_failed = True

    # 3. AI API Endpoints Check
    t0 = time.perf_counter()
    ai_set = db.query(AISettings).first()
    provider = str(ai_set.provider) if (ai_set and ai_set.provider) else "mock"
    api_key = str(ai_set.api_key) if (ai_set and ai_set.api_key) else ""
    model_name = str(ai_set.model_name) if (ai_set and ai_set.model_name) else ""

    ai_res = AIService.test_ai_connection(provider, api_key, model_name)
    t_ai = round((time.perf_counter() - t0) * 1000, 2)
    if ai_res.get("success"):
        results["ai"] = DiagnosticCheckResult(
            name="AI API Endpoints",
            status="success",
            latency_ms=t_ai,
            details=f"AI engine '{provider.upper()}' tested successfully ({ai_res.get('details', 'Response OK')})."
        )
    else:
        results["ai"] = DiagnosticCheckResult(
            name="AI API Endpoints",
            status="failed",
            latency_ms=t_ai,
            details=f"AI endpoint test failed for '{provider}': {ai_res.get('error', 'Connection test failed')}"
        )
        has_failed = True

    # 4. WebSocket Health Check
    t0 = time.perf_counter()
    active_ws_conns = len(sync_ws_manager.active_connections)
    t_ws = round((time.perf_counter() - t0) * 1000, 2)
    results["websocket"] = DiagnosticCheckResult(
        name="WebSocket Health",
        status="success",
        latency_ms=t_ws,
        details=f"WebSocket broadcast server active and online ({active_ws_conns} active connection(s))."
    )

    # 5. DB Integrity Check
    t0 = time.perf_counter()
    try:
        check_val = db.execute(text("PRAGMA quick_check;")).scalar()
        tc_count = db.query(TaskCandidate).count()
        em_count = db.query(EmailMessage).count()
        air_count = db.query(AutoIgnoreRule).count()
        t_db = round((time.perf_counter() - t0) * 1000, 2)

        if check_val == "ok":
            results["db_integrity"] = DiagnosticCheckResult(
                name="Database Integrity",
                status="success",
                latency_ms=t_db,
                details=f"SQLite integrity check passed (PRAGMA quick_check: ok). Table count: {tc_count} task candidates, {em_count} emails, {air_count} auto-ignore rules."
            )
        else:
            results["db_integrity"] = DiagnosticCheckResult(
                name="Database Integrity",
                status="failed",
                latency_ms=t_db,
                details=f"Database integrity check failed: {check_val}"
            )
            has_failed = True
    except Exception as err:
        t_db = round((time.perf_counter() - t0) * 1000, 2)
        results["db_integrity"] = DiagnosticCheckResult(
            name="Database Integrity",
            status="failed",
            latency_ms=t_db,
            details=f"Database integrity query error: {str(err)}"
        )
        has_failed = True

    total_duration_ms = round((time.perf_counter() - start_total) * 1000, 2)
    overall_status = "error" if has_failed else ("warning" if has_warning else "ok")

    return SystemDiagnosticsResponse(
        timestamp=datetime.now(timezone.utc).isoformat(),
        overall_status=overall_status,
        total_duration_ms=total_duration_ms,
        results=results
    )


@router.get("/sync-health")
def get_sync_health_stats(db: Session = Depends(get_db)):
    """Get live IMAP sync health metrics including duration, fetched email count today, and error status."""
    from sc_mail_hub.services.email_service import EmailService
    return EmailService.get_sync_health_stats(db)


@router.get("/config/export")
def export_system_configuration(
    include_system_settings: bool = Query(True),
    include_field_mappings: bool = Query(True),
    include_auto_ignore_rules: bool = Query(True),
    db: Session = Depends(get_db)
):
    """Export selected system settings, Notion field mappings, and auto-ignore rules as a JSON backup file."""
    from datetime import datetime, timezone
    from fastapi.responses import JSONResponse
    from sc_mail_hub.models import NotionFieldMapping, AutoIgnoreRule

    export_data: Dict[str, Any] = {
        "version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat()
    }

    if include_system_settings:
        sys_set = get_or_create_system_settings(db)
        export_data["system_settings"] = {
            "imap_sync_enabled": sys_set.imap_sync_enabled,
            "imap_sync_interval_seconds": sys_set.imap_sync_interval_seconds,
            "ui_auto_refresh_enabled": sys_set.ui_auto_refresh_enabled,
            "ui_auto_refresh_interval_seconds": sys_set.ui_auto_refresh_interval_seconds,
            "auto_purge_synced_enabled": sys_set.auto_purge_synced_enabled,
            "purge_synced_days": sys_set.purge_synced_days,
            "auto_purge_ignored_enabled": sys_set.auto_purge_ignored_enabled,
            "purge_ignored_days": sys_set.purge_ignored_days
        }

    if include_field_mappings:
        mappings = db.query(NotionFieldMapping).all()
        export_data["field_mappings"] = [
            {
                "task_field": m.task_field,
                "notion_property_name": m.notion_property_name,
                "notion_property_type": m.notion_property_type,
                "value_mappings_json": m.value_mappings_json
            }
            for m in mappings
        ]

    if include_auto_ignore_rules:
        rules = db.query(AutoIgnoreRule).all()
        export_data["auto_ignore_rules"] = [
            {
                "name": r.name,
                "rule_type": r.rule_type,
                "pattern": r.pattern,
                "is_active": r.is_active
            }
            for r in rules
        ]


    filename = f"sc-mail-hub-config-{datetime.now(timezone.utc).strftime('%Y%m%d')}.json"
    return JSONResponse(
        content=export_data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/config/import")
def import_system_configuration(payload: ConfigImportRequest, db: Session = Depends(get_db)):
    """Import system settings, field mappings, and auto-ignore rules from a JSON backup payload."""
    from sc_mail_hub.models import NotionFieldMapping, AutoIgnoreRule
    from sc_mail_hub.schemas import ConfigImportRequest

    imported_summary = {
        "system_settings": False,
        "field_mappings_count": 0,
        "auto_ignore_rules_count": 0
    }

    # 1. Update System Settings
    if payload.system_settings is not None:
        sys_set = get_or_create_system_settings(db)
        ss = payload.system_settings
        if "imap_sync_enabled" in ss: sys_set.imap_sync_enabled = bool(ss["imap_sync_enabled"])
        if "imap_sync_interval_seconds" in ss: sys_set.imap_sync_interval_seconds = int(ss["imap_sync_interval_seconds"])
        if "ui_auto_refresh_enabled" in ss: sys_set.ui_auto_refresh_enabled = bool(ss["ui_auto_refresh_enabled"])
        if "ui_auto_refresh_interval_seconds" in ss: sys_set.ui_auto_refresh_interval_seconds = int(ss["ui_auto_refresh_interval_seconds"])
        if "auto_purge_synced_enabled" in ss: sys_set.auto_purge_synced_enabled = bool(ss["auto_purge_synced_enabled"])
        if "purge_synced_days" in ss: sys_set.purge_synced_days = int(ss["purge_synced_days"])
        if "auto_purge_ignored_enabled" in ss: sys_set.auto_purge_ignored_enabled = bool(ss["auto_purge_ignored_enabled"])
        if "purge_ignored_days" in ss: sys_set.purge_ignored_days = int(ss["purge_ignored_days"])
        imported_summary["system_settings"] = True

    # 2. Update Notion Field Mappings
    if payload.field_mappings is not None:
        for m_item in payload.field_mappings:
            task_field = m_item.get("task_field")
            if not task_field:
                continue
            mapping = db.query(NotionFieldMapping).filter(NotionFieldMapping.task_field == task_field).first()
            if not mapping:
                mapping = NotionFieldMapping(
                    task_field=task_field,
                    notion_property_name=m_item.get("notion_property_name", ""),
                    notion_property_type=m_item.get("notion_property_type", "title"),
                    value_mappings_json=m_item.get("value_mappings_json")
                )
                db.add(mapping)
            else:
                mapping.notion_property_name = m_item.get("notion_property_name", mapping.notion_property_name)
                mapping.notion_property_type = m_item.get("notion_property_type", mapping.notion_property_type)
                mapping.value_mappings_json = m_item.get("value_mappings_json", mapping.value_mappings_json)
            imported_summary["field_mappings_count"] += 1

    # 3. Update Auto-Ignore Rules (with strict deduplication)
    if payload.auto_ignore_rules is not None:
        existing_rules = db.query(AutoIgnoreRule).all()
        # Lookups by pattern (lowercase) and name (lowercase)
        pattern_map = {r.pattern.lower(): r for r in existing_rules if r.pattern}
        name_map = {r.name.lower(): r for r in existing_rules if r.name}

        batch_rules_processed = set()

        for r_item in payload.auto_ignore_rules:
            rule_name = (r_item.get("name") or "").strip()
            pattern = (r_item.get("pattern") or "").strip()
            rule_type = r_item.get("rule_type", "sender_domain")
            is_active = bool(r_item.get("is_active", True))

            if not rule_name or not pattern:
                continue

            norm_pattern = pattern.lower()
            norm_name = rule_name.lower()

            existing = pattern_map.get(norm_pattern) or name_map.get(norm_name)

            if existing:
                existing.name = rule_name
                existing.rule_type = rule_type
                existing.pattern = pattern
                existing.is_active = is_active
                pattern_map[norm_pattern] = existing
                name_map[norm_name] = existing
                target_rule = existing
            else:
                new_rule = AutoIgnoreRule(
                    name=rule_name,
                    rule_type=rule_type,
                    pattern=pattern,
                    is_active=is_active
                )
                db.add(new_rule)
                pattern_map[norm_pattern] = new_rule
                name_map[norm_name] = new_rule
                target_rule = new_rule

            if target_rule not in batch_rules_processed:
                batch_rules_processed.add(target_rule)
                imported_summary["auto_ignore_rules_count"] += 1



    db.commit()

    try:
        from sc_mail_hub.main import trigger_immediate_email_sync
        trigger_immediate_email_sync()
    except Exception:
        pass

    return {
        "message": "Configuration imported successfully!",
        "imported": imported_summary
    }


@router.post("/danger/purge-ignored")
def purge_ignored_candidates_now(db: Session = Depends(get_db)):
    """Immediately purge all task candidates marked as IGNORED and their raw email records."""
    from sc_mail_hub.models import TaskCandidate, EmailMessage
    from sc_mail_hub.services.email_service import EmailService

    ignored_candidates = db.query(TaskCandidate).filter(TaskCandidate.status == "IGNORED").all()
    count = len(ignored_candidates)

    for cand in ignored_candidates:
        EmailService.purge_pdf_files(email_id=cand.email_id, candidate_id=cand.id)
        if cand.email_id:
            email_msg = db.query(EmailMessage).filter(EmailMessage.id == cand.email_id).first()
            if email_msg:
                db.delete(email_msg)
        db.delete(cand)

    db.commit()
    return {"message": f"Successfully purged {count} ignored candidate(s).", "purged_count": count}


@router.post("/danger/reset-settings")
def reset_settings_to_defaults(db: Session = Depends(get_db)):
    """Reset system settings to factory defaults."""
    sys_set = get_or_create_system_settings(db)
    sys_set.imap_sync_enabled = True
    sys_set.imap_sync_interval_seconds = 300
    sys_set.ui_auto_refresh_enabled = True
    sys_set.ui_auto_refresh_interval_seconds = 30
    sys_set.auto_purge_synced_enabled = False
    sys_set.purge_synced_days = 30
    sys_set.auto_purge_ignored_enabled = False
    sys_set.purge_ignored_days = 30

    db.commit()
    db.refresh(sys_set)

    try:
        from sc_mail_hub.main import trigger_immediate_email_sync
        trigger_immediate_email_sync()
    except Exception:
        pass

    return {"message": "Application settings reset to factory defaults successfully!"}


