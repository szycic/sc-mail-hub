import os
from fastapi import FastAPI, Request, Depends
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager

from sc_mail_hub.config import settings
from sc_mail_hub.database import engine, Base, init_db, SessionLocal
from sc_mail_hub.models import NotionConfig, NotionFieldMapping, AISettings, EmailAccount
from sc_mail_hub.services.email_service import EmailService
from sc_mail_hub.services.ai_service import AIService
from sc_mail_hub.api import inbox, accounts, notion, ai
import asyncio

init_db()

def setup_defaults(db: Session):
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
        
    db.commit()

_db = SessionLocal()
try:
    setup_defaults(_db)
finally:
    _db.close()

async def background_email_sync_loop():
    """Background task running every 5 minutes to fetch emails automatically."""
    while True:
        try:
            await asyncio.sleep(settings.POLL_INTERVAL_SECONDS)
            db = SessionLocal()
            try:
                accs = db.query(EmailAccount).all()
                for acc in accs:
                    msgs = EmailService.fetch_from_imap(acc, db)
                    for msg in msgs:
                        AIService.ensure_candidate_from_email(msg, db)
            except Exception as err:
                print(f"Background email sync error: {err}")
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Background loop error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
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

@app.get("/")
def root_redirect():
    return RedirectResponse(url="/inbox")

@app.get("/inbox")
@app.get("/notion")
@app.get("/accounts")
@app.get("/ai")
def index_page(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("sc_mail_hub.main:app", host=settings.HOST, port=settings.PORT, reload=True)
