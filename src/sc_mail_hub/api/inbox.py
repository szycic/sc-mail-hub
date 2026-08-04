import asyncio
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from typing import Dict, List, Optional
from sc_mail_hub.database import get_db, SessionLocal
from sc_mail_hub.models import TaskCandidate, EmailMessage, EmailAccount
from sc_mail_hub.schemas import TaskCandidateOut, TaskCandidateUpdate
from sc_mail_hub.services.email_service import EmailService
from sc_mail_hub.services.ai_service import AIService
from sc_mail_hub.services.notion_service import NotionService

router = APIRouter(prefix="/api/inbox", tags=["AI Inbox"])
INGEST_JOB_QUEUES: Dict[str, asyncio.Queue] = {}


def _enqueue_ingest_event(loop: asyncio.AbstractEventLoop, job_id: str, event: dict) -> None:
    def _put() -> None:
        queue = INGEST_JOB_QUEUES.get(job_id)
        if queue is not None:
            queue.put_nowait(event)

    loop.call_soon_threadsafe(_put)


def _run_sample_ingest_job(job_id: str, loop: asyncio.AbstractEventLoop) -> None:
    db = SessionLocal()
    try:
        accounts = db.query(EmailAccount).all()
        if not accounts:
            _enqueue_ingest_event(loop, job_id, {
                "status": "failed",
                "message": "No connected email accounts found. Please add an email account in Connected Accounts tab first."
            })
            return

        _enqueue_ingest_event(loop, job_id, {
            "status": "stage",
            "message": f"⚡ Stage 1/3: Connecting to {len(accounts)} IMAP mailbox(es)..."
        })

        total_emails = 0
        total_candidates = 0

        for idx, account in enumerate(accounts, start=1):
            _enqueue_ingest_event(loop, job_id, {
                "status": "stage",
                "message": f"⚡ Stage 2/3: Syncing account {idx}/{len(accounts)} ({account.email_address})..."
            })

            emails = EmailService.fetch_from_imap(account, db)
            total_emails += len(emails)

            for msg_index, email_msg in enumerate(emails, start=1):
                AIService.ensure_candidate_from_email(email_msg, db)
                total_candidates += 1
                if msg_index == len(emails) or msg_index % 10 == 0:
                    _enqueue_ingest_event(loop, job_id, {
                        "status": "progress",
                        "message": f"Processed {msg_index}/{len(emails)} emails for {account.email_address}.",
                        "emails_synced": total_emails,
                        "candidates_seeded": total_candidates
                    })

        _enqueue_ingest_event(loop, job_id, {
            "status": "completed",
            "message": f"Synced {total_emails} emails and prepared {total_candidates} candidates for AI-on-demand review.",
            "emails_synced": total_emails,
            "candidates_seeded": total_candidates
        })
    except Exception as err:
        _enqueue_ingest_event(loop, job_id, {
            "status": "failed",
            "message": f"Sync failed: {str(err)}"
        })
    finally:
        db.close()


@router.post("/sample-ingest/start")
async def start_sample_ingest_job():
    job_id = str(uuid.uuid4())
    INGEST_JOB_QUEUES[job_id] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    _enqueue_ingest_event(loop, job_id, {
        "status": "started",
        "message": "Starting inbox sync job..."
    })

    asyncio.create_task(asyncio.to_thread(_run_sample_ingest_job, job_id, loop))
    return {"job_id": job_id}


@router.websocket("/ws/sample-ingest/{job_id}")
async def sample_ingest_progress_ws(websocket: WebSocket, job_id: str):
    await websocket.accept()
    queue = INGEST_JOB_QUEUES.get(job_id)
    if queue is None:
        await websocket.send_json({
            "status": "failed",
            "message": "Sync job not found. Please start a new sync."
        })
        await websocket.close()
        return

    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
            if event.get("status") in ("completed", "failed"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        INGEST_JOB_QUEUES.pop(job_id, None)

@router.get("/candidates", response_model=List[TaskCandidateOut])
def get_candidates(
    status: Optional[str] = Query(None, description="Filter by status e.g. PENDING, CREATED, IGNORED, ALL"),
    importance: Optional[str] = Query(None, description="Filter by importance e.g. HIGH, MEDIUM, LOW"),
    db: Session = Depends(get_db)
):
    query = db.query(TaskCandidate)
    if status and status.upper() != "ALL":
        query = query.filter(TaskCandidate.status == status)
    if importance and importance.upper() != "ALL":
        query = query.filter(TaskCandidate.importance == importance)
    
    candidates = query.all()
    importance_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    candidates.sort(key=lambda c: (importance_order.get(c.importance, 3), -c.id))

    result = []
    for c in candidates:
        email_msg = db.query(EmailMessage).filter(EmailMessage.id == c.email_id).first() if c.email_id else None
        out = TaskCandidateOut.model_validate(c)
        if email_msg:
            out.sender = email_msg.sender
            out.recipient = email_msg.recipient
            out.subject = email_msg.subject
            if email_msg.received_at:
                out.received_at = email_msg.received_at.strftime("%d %b %Y, %H:%M")
        result.append(out)
    
    return result

@router.get("/candidates/{candidate_id}/email")
def get_candidate_email_preview(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if not candidate.email_id:
        return {
            "id": None,
            "subject": candidate.title,
            "sender": "Unknown Sender",
            "recipient": "Me",
            "received_at": candidate.created_at.strftime("%d %b %Y, %H:%M") if candidate.created_at else "",
            "body_text": candidate.summary or "No email body text available."
        }

    email_msg = db.query(EmailMessage).filter(EmailMessage.id == candidate.email_id).first()
    if not email_msg:
        raise HTTPException(status_code=404, detail="Email message not found")

    return {
        "id": email_msg.id,
        "subject": email_msg.subject,
        "sender": email_msg.sender,
        "recipient": email_msg.recipient or "Me",
        "received_at": email_msg.received_at.strftime("%d %b %Y, %H:%M") if email_msg.received_at else "",
        "body_text": email_msg.body_text,
        "body_html": getattr(email_msg, "body_html", None)
    }

@router.put("/candidates/{candidate_id}", response_model=TaskCandidateOut)
def update_candidate(candidate_id: int, payload: TaskCandidateUpdate, db: Session = Depends(get_db)):
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    update_data = payload.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(candidate, field, val)

    db.commit()
    db.refresh(candidate)
    
    email_msg = db.query(EmailMessage).filter(EmailMessage.id == candidate.email_id).first() if candidate.email_id else None
    out = TaskCandidateOut.model_validate(candidate)
    if email_msg:
        out.sender = email_msg.sender
        out.subject = email_msg.subject
    return out

@router.post("/candidates/{candidate_id}/prepare-task", response_model=TaskCandidateOut)
def prepare_task_with_ai(candidate_id: int, db: Session = Depends(get_db)):
    """Run AI analysis only when the user explicitly prepares a task for Notion."""
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if not candidate.email_id:
        return TaskCandidateOut.model_validate(candidate)

    email_msg = db.query(EmailMessage).filter(EmailMessage.id == candidate.email_id).first()
    if not email_msg:
        raise HTTPException(status_code=404, detail="Email message not found")

    candidate = AIService.analyze_email(email_msg, db)
    out = TaskCandidateOut.model_validate(candidate)
    out.sender = email_msg.sender
    out.recipient = email_msg.recipient
    out.subject = email_msg.subject
    if email_msg.received_at:
        out.received_at = email_msg.received_at.strftime("%d %b %Y, %H:%M")
    return out

@router.post("/candidates/{candidate_id}/create-task")
def create_task_in_notion(candidate_id: int, payload: Optional[TaskCandidateUpdate] = None, db: Session = Depends(get_db)):
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if payload:
        update_data = payload.model_dump(exclude_unset=True)
        for field, val in update_data.items():
            setattr(candidate, field, val)
        db.commit()
        db.refresh(candidate)

    res = NotionService.create_notion_task(candidate, db)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to create task in Notion"))

    return {
        "message": "Task successfully created in Notion!",
        "candidate_id": candidate.id,
        "notion_url": candidate.notion_url,
        "notion_page_id": candidate.notion_page_id
    }

@router.post("/candidates/{candidate_id}/ignore")
def ignore_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    candidate.status = "IGNORED"
    db.commit()
    return {"message": "Task candidate marked as ignored", "candidate_id": candidate.id}

@router.post("/candidates/{candidate_id}/unignore")
def unignore_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    candidate.status = "PENDING"
    db.commit()
    return {"message": "Task candidate restored to pending", "candidate_id": candidate.id}

@router.delete("/candidates/{candidate_id}")
def delete_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    email_id = candidate.email_id
    db.delete(candidate)
    if email_id:
        email_msg = db.query(EmailMessage).filter(EmailMessage.id == email_id).first()
        if email_msg:
            if email_msg.account_id:
                account = db.query(EmailAccount).filter(EmailAccount.id == email_msg.account_id).first()
                if account:
                    if email_msg.email_uid and account.last_uid is not None:
                        rewind_target = max(0, int(email_msg.email_uid) - 1)
                        account.last_uid = min(int(account.last_uid), rewind_target)
                    elif not email_msg.email_uid:
                        account.last_uid = None
            db.delete(email_msg)
    db.commit()
    return {"message": "Message deleted successfully", "candidate_id": candidate_id}

@router.delete("/clear-all")
@router.delete("/candidates/clear-all")
def clear_all_messages(db: Session = Depends(get_db)):
    candidates_count = db.query(TaskCandidate).delete()
    emails_count = db.query(EmailMessage).delete()
    for account in db.query(EmailAccount).all():
        account.last_uid = 0
        account.last_synced_at = None
    db.commit()
    return {
        "message": "Inbox emptied successfully",
        "deleted_candidates": candidates_count,
        "deleted_emails": emails_count
    }

@router.post("/sample-ingest")
def trigger_sample_ingest(db: Session = Depends(get_db)):
    """Sync emails from connected IMAP accounts or demand connected account first."""
    accounts = db.query(EmailAccount).all()
    if not accounts:
        raise HTTPException(
            status_code=400,
            detail="No connected email accounts found. Please add an email account in Connected Accounts tab first."
        )

    total_emails = []
    new_candidates = []
    for account in accounts:
        emails = EmailService.fetch_from_imap(account, db)
        total_emails.extend(emails)
        for email_msg in emails:
            cand = AIService.ensure_candidate_from_email(email_msg, db)
            new_candidates.append(cand.id)

    return {
        "message": f"Synced {len(total_emails)} emails and prepared {len(new_candidates)} candidates for AI-on-demand review.",
        "candidates_created": len(new_candidates)
    }
