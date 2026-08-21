"""SQLAlchemy Database Models for SC Mail Hub.

Defines tables for email accounts, fetched email messages, task candidates,
Notion configuration & field mappings, and AI settings.
"""

from datetime import datetime, timezone
from typing import Any
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sc_mail_hub.database import Base


def _utc_now():
    return datetime.now(timezone.utc)


class EmailAccount(Base):
    """Stores connected email account credentials and IMAP sync state."""
    __tablename__ = "email_accounts"

    id: Any = Column(Integer, primary_key=True, index=True)
    name: Any = Column(String(100), nullable=False)
    provider: Any = Column(String(50), nullable=False)  # 'gmail', 'zoho', 'imap'
    email_address: Any = Column(String(255), nullable=False)
    auth_type: Any = Column(String(50), default="imap")  # 'oauth2', 'password'
    credentials_json: Any = Column(Text, nullable=True)  # Store JSON with host, port, pass, oauth tokens
    is_active: Any = Column(Boolean, default=True)
    last_uid: Any = Column(Integer, nullable=True)
    uid_validity: Any = Column(String(64), nullable=True)
    last_synced_at: Any = Column(DateTime, nullable=True)
    created_at: Any = Column(DateTime, default=_utc_now)

    emails = relationship("EmailMessage", back_populates="account", cascade="all, delete-orphan")


class EmailMessage(Base):
    """Stores raw fetched email messages from connected mailboxes."""
    __tablename__ = "email_messages"

    id: Any = Column(Integer, primary_key=True, index=True)
    account_id: Any = Column(Integer, ForeignKey("email_accounts.id"), nullable=True, index=True)
    account_email: Any = Column(String(255), nullable=True)
    email_uid: Any = Column(Integer, nullable=True)
    message_id: Any = Column(String(255), index=True, nullable=True)
    sender: Any = Column(String(255), nullable=False)
    recipient: Any = Column(String(255), nullable=True)
    subject: Any = Column(String(500), nullable=False)
    body_text: Any = Column(Text, nullable=False)
    received_at: Any = Column(DateTime, default=_utc_now)
    is_processed: Any = Column(Boolean, default=False)

    account = relationship("EmailAccount", back_populates="emails")
    task_candidate = relationship("TaskCandidate", back_populates="email", uselist=False, cascade="all, delete-orphan")


class TaskCandidate(Base):
    """Stores email-extracted task candidates and their lifecycle stage."""
    __tablename__ = "task_candidates"

    id: Any = Column(Integer, primary_key=True, index=True)
    email_id: Any = Column(Integer, ForeignKey("email_messages.id"), nullable=True, index=True)
    title: Any = Column(String(255), nullable=False)
    summary: Any = Column(Text, nullable=True)
    is_task: Any = Column(Boolean, default=True)
    priority: Any = Column(String(20), nullable=True)       # Select option matching Notion schema (e.g. 'HIGH', 'MEDIUM', 'LOW')
    start_date: Any = Column(String(100), nullable=True)     # ISO YYYY-MM-DD or formatted date string
    deadline: Any = Column(String(100), nullable=True)       # ISO YYYY-MM-DD or formatted due date string
    source_url: Any = Column(String(500), nullable=True)     # Extracted HTTP/HTTPS URL from email message body
    project: Any = Column(String(100), nullable=True)        # e.g. "ESN Poland"
    status: Any = Column(String(20), default="PENDING", index=True)      # 'PENDING', 'AI_PROCESSED', 'CREATED', 'IGNORED'
    previous_status: Any = Column(String(20), nullable=True) # Tracks exact stage prior to IGNORED status for unignoring
    auto_ignored_reason: Any = Column(String(255), nullable=True) # Stores rule name if automatically ignored
    notion_page_id: Any = Column(String(255), nullable=True)

    notion_url: Any = Column(String(500), nullable=True)
    created_at: Any = Column(DateTime, default=_utc_now)
    updated_at: Any = Column(DateTime, default=_utc_now, onupdate=_utc_now)

    email = relationship("EmailMessage", back_populates="task_candidate")


class NotionConfig(Base):
    """Stores Notion API integration token and target database ID."""
    __tablename__ = "notion_configs"

    id: Any = Column(Integer, primary_key=True, index=True)
    api_token: Any = Column(String(255), nullable=True)
    database_id: Any = Column(String(255), nullable=True)
    database_title: Any = Column(String(255), nullable=True)
    last_schema_json: Any = Column(Text, nullable=True)


class NotionFieldMapping(Base):
    """Stores mapping between TaskCandidate fields and Notion Database properties."""
    __tablename__ = "notion_field_mappings"

    id: Any = Column(Integer, primary_key=True, index=True)
    task_field: Any = Column(String(50), unique=True, nullable=False)  # 'title', 'summary', 'deadline', 'priority', 'project', 'sender', 'email_date', 'source_url', 'importance'
    notion_property_name: Any = Column(String(100), nullable=False)     # Property name in Notion (e.g., 'Task Name')
    notion_property_type: Any = Column(String(50), nullable=False)      # Notion type ('title', 'rich_text', 'date', 'select', 'status', 'url')
    value_mappings_json: Any = Column(Text, nullable=True)             # Options map JSON string


class AISettings(Base):
    """Stores AI engine provider configuration (Mock, OpenAI, Gemini, Groq)."""
    __tablename__ = "ai_settings"

    id: Any = Column(Integer, primary_key=True, index=True)
    provider: Any = Column(String(50), default="mock")  # 'mock', 'openai', 'gemini', 'groq'
    api_key: Any = Column(String(255), nullable=True)
    model_name: Any = Column(String(100), nullable=True)
    custom_prompt: Any = Column(Text, nullable=True)


class SystemSettings(Base):
    """Stores system-wide administrative configuration (IMAP sync, UI refresh, & auto-purge settings)."""
    __tablename__ = "system_settings"

    id: Any = Column(Integer, primary_key=True, index=True)

    # Background IMAP Email Sync Configuration
    imap_sync_enabled: Any = Column(Boolean, default=True)
    imap_sync_interval_seconds: Any = Column(Integer, default=300)

    # Frontend Dashboard UI Auto-Refresh Configuration
    ui_auto_refresh_enabled: Any = Column(Boolean, default=True)
    ui_auto_refresh_interval_seconds: Any = Column(Integer, default=30)

    # Automatic Purge Settings
    auto_purge_synced_enabled: Any = Column(Boolean, default=False)
    purge_synced_days: Any = Column(Integer, default=30)

    auto_purge_ignored_enabled: Any = Column(Boolean, default=False)
    purge_ignored_days: Any = Column(Integer, default=30)

    # Web Push VAPID Configuration
    vapid_private_key: Any = Column(Text, nullable=True)
    vapid_public_key: Any = Column(Text, nullable=True)
    vapid_claims_sub: Any = Column(String(255), default="mailto:admin@sc-mail-hub.local")

    # Persistent Daily IMAP Activity Tracking
    daily_ingested_count: Any = Column(Integer, default=0)
    daily_ingested_date: Any = Column(String(10), nullable=True)
    received_at_utc_migrated: Any = Column(Boolean, default=False)

    updated_at: Any = Column(DateTime, default=_utc_now, onupdate=_utc_now)


class PushSubscription(Base):
    """Stores Web Push API subscriptions for client devices to receive push notifications when app is closed."""
    __tablename__ = "push_subscriptions"

    id: Any = Column(Integer, primary_key=True, index=True)
    endpoint: Any = Column(Text, unique=True, nullable=False, index=True)
    p256dh: Any = Column(Text, nullable=False)
    auth: Any = Column(Text, nullable=False)
    user_agent: Any = Column(String(255), nullable=True)
    created_at: Any = Column(DateTime, default=_utc_now)


class AutoIgnoreRule(Base):
    """Stores user-defined auto-ignore rules for incoming email ingestion."""
    __tablename__ = "auto_ignore_rules"

    id: Any = Column(Integer, primary_key=True, index=True)
    name: Any = Column(String(100), nullable=False)
    rule_type: Any = Column(String(50), nullable=False)  # 'sender_domain', 'sender_contains', 'subject_keyword', 'subject_regex'
    pattern: Any = Column(String(255), nullable=False)
    is_active: Any = Column(Boolean, default=True)
    created_at: Any = Column(DateTime, default=_utc_now)

