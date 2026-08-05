"""FastAPI Application Entry Point for SC Mail Hub.

Sets up application routes, static file serving, HTML templates,
lifespan background email polling loop, and initial default configuration.
"""

import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from sc_mail_hub.config import settings
from sc_mail_hub.database import engine, Base, init_db, SessionLocal
from sc_mail_hub.models import NotionConfig, NotionFieldMapping, AISettings, EmailAccount, SystemSettings, TaskCandidate, EmailMessage, AutoIgnoreRule
from sc_mail_hub.services.email_service import EmailService
from sc_mail_hub.services.ai_service import AIService
from sc_mail_hub.api import inbox, accounts, notion, ai, admin, rules

logger = logging.getLogger("sc_mail_hub.main")
init_db()


def setup_defaults(db: Session):
    """Seed initial default configurations for Notion, AI, System settings, and default Auto-Ignore rules if absent."""
    notion_cfg = db.query(NotionConfig).first()
    if not notion_cfg:
        notion_cfg = NotionConfig(
            api_token=settings.NOTION_API_KEY,
            database_id=settings.NOTION_DATABASE_ID,
            database_title="Tasks DB"
        )
        db.add(notion_cfg)
    
    ai_set = db.query(AISettings).first()
    if not ai_set:
        db.add(AISettings(
            provider="mock",
            api_key=settings.OPENAI_API_KEY or settings.GEMINI_API_KEY or "",
            model_name=""
        ))
        
    sys_set = db.query(SystemSettings).first()
    if not sys_set:
        db.add(SystemSettings(
            imap_sync_enabled=True,
            imap_sync_interval_seconds=300,
            ui_auto_refresh_enabled=True,
            ui_auto_refresh_interval_seconds=30
        ))

    if db.query(AutoIgnoreRule).count() == 0:
        default_rules = [
            AutoIgnoreRule(
                name="Automated System Notifications",
                rule_type="sender_contains",
                pattern="no-reply@",
                is_active=True
            ),
            AutoIgnoreRule(
                name="Promotional Newsletters",
                rule_type="subject_keyword",
                pattern="newsletter",
                is_active=True
            ),
            AutoIgnoreRule(
                name="Weekly / Daily Digests",
                rule_type="subject_keyword",
                pattern="digest",
                is_active=True
            ),
            AutoIgnoreRule(
                name="Google Service Announcements",
                rule_type="sender_contains",
                pattern="no-reply@google.com",
                is_active=True
            ),
            AutoIgnoreRule(
                name="LinkedIn Job Alerts & InMail",
                rule_type="sender_domain",
                pattern="linkedin.com",
                is_active=True
            ),
            AutoIgnoreRule(
                name="Security Codes & 2FA Emails",
                rule_type="subject_keyword",
                pattern="verification code",
                is_active=True
            ),
            AutoIgnoreRule(
                name="Automated System Monitoring",
                rule_type="subject_regex",
                pattern=r"(ALERT|STATUS|MONITORING)",
                is_active=True
            ),
            AutoIgnoreRule(
                name="Marketing Offers & Discounts",
                rule_type="subject_keyword",
                pattern="special offer",
                is_active=True
            )
        ]
        db.add_all(default_rules)

    db.commit()




def purge_expired_candidates(db: Session):
    """Purge candidates synced to Notion or Ignored (and raw email records) older than configured retention days."""
    try:
        sys_set = db.query(SystemSettings).first()
        if not sys_set:
            return

        now = datetime.now(timezone.utc)

        def purge_status_items(status_code: str, retention_days: int):
            cutoff = now - timedelta(days=retention_days)
            expired_candidates = db.query(TaskCandidate).filter(
                TaskCandidate.status == status_code,
                TaskCandidate.updated_at <= cutoff
            ).all()

            for cand in expired_candidates:
                EmailService.purge_pdf_files(email_id=cand.email_id, candidate_id=cand.id)
                if cand.email_id:
                    email_msg = db.query(EmailMessage).filter(EmailMessage.id == cand.email_id).first()
                    if email_msg:
                        db.delete(email_msg)
                db.delete(cand)

        if sys_set.auto_purge_synced_enabled and sys_set.purge_synced_days > 0:
            purge_status_items("CREATED", sys_set.purge_synced_days)

        if sys_set.auto_purge_ignored_enabled and sys_set.purge_ignored_days > 0:
            purge_status_items("IGNORED", sys_set.purge_ignored_days)

        db.commit()
    except Exception as err:
        logger.error(f"Auto-purge execution error: {err}")


sync_trigger_event = asyncio.Event()


def trigger_immediate_email_sync():
    """Signal background email sync loop to wake up immediately and apply new settings."""
    try:
        loop = asyncio.get_running_loop()
        loop.call_soon_threadsafe(sync_trigger_event.set)
    except RuntimeError:
        sync_trigger_event.set()


def _run_email_sync() -> bool:
    """Synchronous worker thread function to fetch IMAP emails without blocking main asyncio event loop."""
    db = SessionLocal()
    try:
        sys_set = db.query(SystemSettings).first()
        if not sys_set or not sys_set.imap_sync_enabled:
            return False

        accs = db.query(EmailAccount).all()
        # Explicitly commit initial read transaction so no SQLite lock is held during IMAP network socket downloads
        db.commit()

        for acc in accs:
            msgs = EmailService.fetch_from_imap(acc, db)
            for msg in msgs:
                AIService.ensure_candidate_from_email(msg, db)
        return True
    except Exception as err:
        logger.error(f"Background email sync error: {err}")
        return False
    finally:
        db.close()


async def background_email_sync_loop():
    """Background email polling task dynamically configured via SystemSettings DB table."""
    while True:
        try:
            poll_seconds = 300

            db = SessionLocal()
            try:
                sys_set = db.query(SystemSettings).first()
                if sys_set:
                    poll_seconds = sys_set.imap_sync_interval_seconds
                purge_expired_candidates(db)
            finally:
                db.close()

            # Offload blocking IMAP network socket I/O to a worker thread so HTTP routes remain instant
            synced = await asyncio.to_thread(_run_email_sync)
            if synced:
                inbox.set_last_synced_at()
                await inbox.notify_sync_completed_async()

            sync_trigger_event.clear()
            try:
                await asyncio.wait_for(sync_trigger_event.wait(), timeout=max(poll_seconds, 5))
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Background loop error: {e}")
            await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application background task lifecycle on startup and shutdown."""
    db = SessionLocal()
    try:
        setup_defaults(db)
    finally:
        db.close()

    sync_task = asyncio.create_task(background_email_sync_loop())
    yield
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan
)

static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

templates_dir = os.path.join(os.path.dirname(__file__), "templates")
templates = Jinja2Templates(directory=templates_dir)

app.include_router(inbox.router)
app.include_router(accounts.router)
app.include_router(notion.router)
app.include_router(ai.router)
app.include_router(admin.router)
app.include_router(rules.router)



@app.get("/sw.js")
def service_worker():
    """Serve service worker javascript file at root path."""
    return FileResponse(
        os.path.join(static_dir, "js", "sw.js"),
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/"}
    )


@app.get("/")
def root_redirect():
    """Redirect root path to the main inbox UI dashboard."""
    return RedirectResponse(url="/inbox")


@app.get("/inbox")
@app.get("/notion")
@app.get("/accounts")
@app.get("/ai")
@app.get("/admin")
def index_page(request: Request):
    """Serve single-page app index HTML template."""
    return templates.TemplateResponse(request=request, name="index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("sc_mail_hub.main:app", host=settings.HOST, port=settings.PORT, reload=True)
