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
    return acc

@router.delete("/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    acc = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
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
        AIService.analyze_email(msg, db)
        task_count += 1

@router.post("/{account_id}/test")
def test_account_connection(account_id: int, db: Session = Depends(get_db)):
    acc = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    res = EmailService.test_imap_connection(acc.credentials_json)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "IMAP connection failed"))
    return res

@router.post("/test-credentials")
def test_raw_credentials(payload: EmailAccountCreate):
    res = EmailService.test_imap_connection(payload.credentials_json)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "IMAP connection failed"))
    return res
