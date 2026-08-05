"""Auto-Ignore Rules REST API Router for SC Mail Hub.

Provides endpoints to create, list, update, delete, and test auto-ignore rules for email ingestion.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from sc_mail_hub.database import get_db
from sc_mail_hub.models import AutoIgnoreRule
from sc_mail_hub.schemas import (
    AutoIgnoreRuleCreate,
    AutoIgnoreRuleUpdate,
    AutoIgnoreRuleOut,
    RuleTestRequest,
    RuleTestResponse
)
from sc_mail_hub.services.rule_service import RuleService

router = APIRouter(prefix="/api/rules", tags=["Auto-Ignore Rules"])

VALID_RULE_TYPES = {"sender_domain", "sender_contains", "subject_keyword", "subject_regex"}


@router.get("", response_model=List[AutoIgnoreRuleOut])
def list_rules(db: Session = Depends(get_db)):
    """List all auto-ignore rules ordered by ID in ascending order (lowest ID first)."""
    return db.query(AutoIgnoreRule).order_by(AutoIgnoreRule.id.asc()).all()



@router.post("", response_model=AutoIgnoreRuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(payload: AutoIgnoreRuleCreate, db: Session = Depends(get_db)):
    """Create a new auto-ignore rule."""
    if payload.rule_type not in VALID_RULE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid rule_type '{payload.rule_type}'. Valid options are: {', '.join(sorted(VALID_RULE_TYPES))}"
        )
    if not payload.pattern or not payload.pattern.strip():
        raise HTTPException(status_code=400, detail="Rule pattern cannot be empty.")

    rule = AutoIgnoreRule(
        name=payload.name.strip(),
        rule_type=payload.rule_type,
        pattern=payload.pattern.strip(),
        is_active=payload.is_active
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=AutoIgnoreRuleOut)
def update_rule(rule_id: int, payload: AutoIgnoreRuleUpdate, db: Session = Depends(get_db)):
    """Update an existing auto-ignore rule."""
    rule = db.query(AutoIgnoreRule).filter(AutoIgnoreRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Auto-ignore rule not found.")

    if payload.rule_type is not None:
        if payload.rule_type not in VALID_RULE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid rule_type '{payload.rule_type}'. Valid options are: {', '.join(sorted(VALID_RULE_TYPES))}"
            )
        rule.rule_type = payload.rule_type

    if payload.name is not None:
        rule.name = payload.name.strip()

    if payload.pattern is not None:
        if not payload.pattern.strip():
            raise HTTPException(status_code=400, detail="Rule pattern cannot be empty.")
        rule.pattern = payload.pattern.strip()

    if payload.is_active is not None:
        rule.is_active = payload.is_active

    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    """Delete an auto-ignore rule."""
    rule = db.query(AutoIgnoreRule).filter(AutoIgnoreRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Auto-ignore rule not found.")

    db.delete(rule)
    db.commit()
    return {"message": f"Auto-ignore rule ID {rule_id} deleted successfully."}


@router.post("/test", response_model=RuleTestResponse)
def test_rules(payload: RuleTestRequest, db: Session = Depends(get_db)):
    """Test a sample sender and subject against all active auto-ignore rules."""
    matched_rule = RuleService.evaluate_auto_ignore_rules(payload.sender or "", payload.subject or "", db)
    if matched_rule:
        return RuleTestResponse(matched=True, matched_rule=AutoIgnoreRuleOut.model_validate(matched_rule))
    return RuleTestResponse(matched=False, matched_rule=None)


@router.post("/seed-defaults", response_model=List[AutoIgnoreRuleOut])
def seed_default_rules(db: Session = Depends(get_db)):
    """Seed typical standard auto-ignore rules if missing."""
    preset_rules = [
        ("Automated System Notifications", "sender_contains", "no-reply@"),
        ("Promotional Newsletters", "subject_keyword", "newsletter"),
        ("Weekly / Daily Digests", "subject_keyword", "digest"),
        ("Google Service Announcements", "sender_contains", "no-reply@google.com"),
        ("LinkedIn Job Alerts & InMail", "sender_domain", "linkedin.com"),
        ("Security Codes & 2FA Emails", "subject_keyword", "verification code"),
        ("Automated System Monitoring", "subject_regex", r"(ALERT|STATUS|MONITORING)"),
        ("Marketing Offers & Discounts", "subject_keyword", "special offer")
    ]

    existing_patterns = {r.pattern.lower() for r in db.query(AutoIgnoreRule).all()}
    added_rules = []

    for name, rule_type, pattern in preset_rules:
        if pattern.lower() not in existing_patterns:
            rule = AutoIgnoreRule(name=name, rule_type=rule_type, pattern=pattern, is_active=True)
            db.add(rule)
            added_rules.append(rule)

    db.commit()
    for r in added_rules:
        db.refresh(r)

    return db.query(AutoIgnoreRule).order_by(AutoIgnoreRule.id.asc()).all()


