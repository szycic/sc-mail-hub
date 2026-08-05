"""Auto-Ignore Rule Service for SC Mail Hub.

Evaluates user-defined rules (sender domain, sender substring, subject keyword, subject regex)
against incoming email messages during ingestion.
"""

import re
import logging
from typing import Optional, List
from sqlalchemy.orm import Session
from sc_mail_hub.models import AutoIgnoreRule

logger = logging.getLogger("sc_mail_hub.rule_service")


class RuleService:
    @staticmethod
    def extract_email_address(sender_str: str) -> str:
        """Extract clean email address from sender string (e.g. 'John Doe <john@example.com>' -> 'john@example.com')."""
        if not sender_str:
            return ""
        match = re.search(r'<([^>]+)>', sender_str)
        if match:
            return match.group(1).strip().lower()
        return sender_str.strip().lower()

    @staticmethod
    def extract_domain(email_str: str) -> str:
        """Extract domain part from an email address or string."""
        clean_addr = RuleService.extract_email_address(email_str)
        if "@" in clean_addr:
            return clean_addr.split("@")[-1].strip().lower()
        return clean_addr.strip().lower()

    @staticmethod
    def matches_rule(rule: AutoIgnoreRule, sender: str, subject: str) -> bool:
        """Check if an email sender and subject match a single AutoIgnoreRule."""
        if not rule.is_active or not rule.pattern:
            return False

        pattern = rule.pattern.strip()
        rule_type = rule.rule_type

        try:
            if rule_type == "sender_domain":
                sender_domain = RuleService.extract_domain(sender)
                target_domain = pattern.lower().lstrip("@")
                if not sender_domain or not target_domain:
                    return False
                return sender_domain == target_domain or sender_domain.endswith("." + target_domain)

            elif rule_type == "sender_contains":
                sender_lower = (sender or "").lower()
                return pattern.lower() in sender_lower

            elif rule_type == "subject_keyword":
                subject_lower = (subject or "").lower()
                return pattern.lower() in subject_lower

            elif rule_type == "subject_regex":
                subject_str = subject or ""
                return bool(re.search(pattern, subject_str, re.IGNORECASE))

        except Exception as err:
            logger.warning(f"Error evaluating rule ID={rule.id} ('{rule.name}'): {err}")
            return False

        return False

    @staticmethod
    def evaluate_auto_ignore_rules(sender: str, subject: str, db: Session) -> Optional[AutoIgnoreRule]:
        """Check all active auto-ignore rules against an email sender and subject.
        
        Returns the first matching AutoIgnoreRule, or None if no rules match.
        """
        active_rules = db.query(AutoIgnoreRule).filter(AutoIgnoreRule.is_active == True).order_by(AutoIgnoreRule.id.asc()).all()
        for rule in active_rules:
            if RuleService.matches_rule(rule, sender, subject):
                logger.info(f"🛡️ Auto-ignore rule matched! Rule ID={rule.id} ('{rule.name}', type='{rule.rule_type}') matched sender='{sender}', subject='{subject}'")
                return rule
        return None
