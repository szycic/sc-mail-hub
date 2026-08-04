from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from sc_mail_hub.database import get_db
from sc_mail_hub.models import TaskCandidate, EmailMessage, EmailAccount
from sc_mail_hub.schemas import TaskCandidateOut, TaskCandidateUpdate
from sc_mail_hub.services.email_service import EmailService
from sc_mail_hub.services.ai_service import AIService
from sc_mail_hub.services.notion_service import NotionService

router = APIRouter(prefix="/api/inbox", tags=["AI Inbox"])

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

@router.post("/candidates/{candidate_id}/create-task")
def create_task_in_notion(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(TaskCandidate).filter(TaskCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

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
            db.delete(email_msg)
    db.commit()
    return {"message": "Message deleted successfully", "candidate_id": candidate_id}

@router.delete("/clear-all")
@router.delete("/candidates/clear-all")
def clear_all_messages(db: Session = Depends(get_db)):
    candidates_count = db.query(TaskCandidate).delete()
    emails_count = db.query(EmailMessage).delete()
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
            cand = AIService.analyze_email(email_msg, db)
            new_candidates.append(cand.id)

    return {
        "message": f"Synced {len(total_emails)} emails and generated {len(new_candidates)} task candidates.",
        "candidates_created": len(new_candidates)
    }
