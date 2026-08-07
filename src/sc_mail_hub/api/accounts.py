"""Email Accounts API Router for SC Mail Hub.

Manages email account connections, IMAP authentication testing,
manual email sync triggers, and account deletion.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
from sc_mail_hub.database import get_db
from sc_mail_hub.models import EmailAccount, EmailMessage
from sc_mail_hub.schemas import EmailAccountCreate, EmailAccountOut
from sc_mail_hub.services.email_service import EmailService
from sc_mail_hub.services.ai_service import AIService

router = APIRouter(prefix="/api/accounts", tags=["Email Accounts"])

@router.get("", response_model=List[EmailAccountOut])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(EmailAccount).all()

@router.get("/filter-options")
def get_account_filter_options(db: Session = Depends(get_db)):
    active_accounts = db.query(EmailAccount).all()
    active_emails = {acc.email_address: acc.name for acc in active_accounts}

    distinct_rows = db.query(EmailMessage.account_email).filter(EmailMessage.account_email.isnot(None)).distinct().all()
    all_emails = [r[0] for r in distinct_rows if r[0]]

    for email_addr in active_emails:
        if email_addr not in all_emails:
            all_emails.append(email_addr)

    options = []
    for email_addr in all_emails:
        is_active = email_addr in active_emails
        name = active_emails.get(email_addr)
        label = f"{name} ({email_addr})" if (is_active and name and name != email_addr) else (email_addr if is_active else f"{email_addr} (Disconnected)")
        options.append({
            "email_address": email_addr,
            "label": label,
            "is_active": is_active
        })

    options.sort(key=lambda x: (not x["is_active"], x["label"].lower()))
    return options

@router.post("", response_model=EmailAccountOut)
def create_account(payload: EmailAccountCreate, db: Session = Depends(get_db)):
    acc = EmailAccount(
        name=payload.name,
        provider=payload.provider.lower(),
        email_address=payload.email_address,
        auth_type=payload.auth_type,
        credentials_json=payload.credentials_json
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)
    
    db.query(EmailMessage).filter(
        (EmailMessage.account_email == acc.email_address) & (EmailMessage.account_id.is_(None))
    ).update({EmailMessage.account_id: acc.id}, synchronize_session=False)
    db.commit()

    return acc

@router.delete("/{account_id}")
def delete_account(account_id: int, delete_emails: bool = False, db: Session = Depends(get_db)):
    acc = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    if delete_emails:
        email_ids = [msg_id for (msg_id,) in db.query(EmailMessage.id).filter(EmailMessage.account_id == account_id).all()]
        if email_ids:
            from sc_mail_hub.models import TaskCandidate
            db.query(TaskCandidate).filter(TaskCandidate.email_id.in_(email_ids)).delete(synchronize_session=False)
            db.query(EmailMessage).filter(EmailMessage.account_id == account_id).delete(synchronize_session=False)
        db.delete(acc)
    else:
        db.query(EmailMessage).filter(EmailMessage.account_id == account_id).update({EmailMessage.account_id: None}, synchronize_session=False)
        acc.emails = []
        db.delete(acc)

    db.commit()
    return {"message": "Account removed successfully"}

@router.post("/{account_id}/sync")
def sync_account(account_id: int, db: Session = Depends(get_db)):
    acc = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    new_messages = EmailService.fetch_from_imap(acc, db)
    task_count = 0
    for msg in new_messages:
        AIService.ensure_candidate_from_email(msg, db)
        task_count += 1

    from sc_mail_hub.api.inbox import set_last_synced_at, notify_sync_completed
    set_last_synced_at()
    notify_sync_completed()

    return {
        "message": f"Synced {len(new_messages)} emails",
        "emails_synced": len(new_messages),
        "candidates_seeded": task_count
    }

@router.post("/{account_id}/test")
def test_account_connection(account_id: int, db: Session = Depends(get_db)):
    acc = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not acc or not acc.credentials_json:
        raise HTTPException(status_code=404, detail="Account credentials not found")

    res = EmailService.test_imap_connection(str(acc.credentials_json))
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "IMAP connection failed"))
    return res

@router.post("/test-credentials")
def test_raw_credentials(payload: EmailAccountCreate):
    if not payload.credentials_json:
        raise HTTPException(status_code=400, detail="Credentials JSON is required")
    res = EmailService.test_imap_connection(payload.credentials_json)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "IMAP connection failed"))
    return res
