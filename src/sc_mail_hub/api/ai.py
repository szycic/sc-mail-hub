"""AI Settings API Router for SC Mail Hub.

Manages AI provider configuration (Mock, OpenAI, Gemini, Groq),
API key settings, model name choices, and connection test endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sc_mail_hub.database import get_db
from sc_mail_hub.models import AISettings, EmailMessage
from sc_mail_hub.schemas import AISettingsUpdate, AISettingsOut
from sc_mail_hub.services.ai_service import AIService

router = APIRouter(prefix="/api/ai", tags=["AI Settings"])

@router.get("/settings", response_model=AISettingsOut)
def get_ai_settings(db: Session = Depends(get_db)):
    ai_set = db.query(AISettings).first()
    if not ai_set:
        ai_set = AISettings(provider="mock")
        db.add(ai_set)
        db.commit()
        db.refresh(ai_set)

    return AISettingsOut(
        provider=ai_set.provider,
        api_key_configured=bool(ai_set.api_key),
        model_name=ai_set.model_name,
        custom_prompt=ai_set.custom_prompt
    )

@router.post("/settings", response_model=AISettingsOut)
def update_ai_settings(payload: AISettingsUpdate, db: Session = Depends(get_db)):
    ai_set = db.query(AISettings).first()
    if not ai_set:
        ai_set = AISettings()
        db.add(ai_set)

    ai_set.provider = payload.provider
    if payload.api_key is not None:
        ai_set.api_key = payload.api_key.strip()
    if payload.model_name:
        ai_set.model_name = payload.model_name
    if payload.custom_prompt:
        ai_set.custom_prompt = payload.custom_prompt

    db.commit()
    db.refresh(ai_set)

    return AISettingsOut(
        provider=ai_set.provider,
        api_key_configured=bool(ai_set.api_key),
        model_name=ai_set.model_name,
        custom_prompt=ai_set.custom_prompt
    )

@router.post("/reanalyze-email/{email_id}")
def reanalyze_email(email_id: int, db: Session = Depends(get_db)):
    email_msg = db.query(EmailMessage).filter(EmailMessage.id == email_id).first()
    if not email_msg:
        raise HTTPException(status_code=404, detail="Email message not found")

    candidate = AIService.analyze_email(email_msg, db)
    return {"message": "Email re-analyzed successfully", "candidate_id": candidate.id}

@router.post("/test")
def test_ai_connection_endpoint(payload: AISettingsUpdate = None, db: Session = Depends(get_db)):
    ai_set = db.query(AISettings).first()
    provider = (payload.provider if payload and payload.provider else (ai_set.provider if ai_set else "mock"))
    api_key = (payload.api_key if payload and payload.api_key is not None else (ai_set.api_key if ai_set else ""))
    model_name = (payload.model_name if payload and payload.model_name else (ai_set.model_name if ai_set else ""))

    res = AIService.test_ai_connection(provider, api_key, model_name)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "AI connection test failed"))
    return res
