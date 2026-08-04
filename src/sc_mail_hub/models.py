"""SQLAlchemy Database Models for SC Mail Hub.

Defines tables for email accounts, fetched email messages, task candidates,
Notion configuration & field mappings, and AI settings.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sc_mail_hub.database import Base


class EmailAccount(Base):
    """Stores connected email account credentials and IMAP sync state."""
    __tablename__ = "email_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    provider = Column(String(50), nullable=False)  # 'gmail', 'zoho', 'imap'
    email_address = Column(String(255), nullable=False)
    auth_type = Column(String(50), default="imap")  # 'oauth2', 'password'
    credentials_json = Column(Text, nullable=True)  # Store JSON with host, port, pass, oauth tokens
    is_active = Column(Boolean, default=True)
    last_uid = Column(Integer, nullable=True)
    uid_validity = Column(String(64), nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    emails = relationship("EmailMessage", back_populates="account", cascade="all, delete-orphan")


class EmailMessage(Base):
    """Stores raw fetched email messages from connected mailboxes."""
    __tablename__ = "email_messages"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("email_accounts.id"), nullable=True, index=True)
    email_uid = Column(Integer, nullable=True)
    message_id = Column(String(255), index=True, nullable=True)
    sender = Column(String(255), nullable=False)
    recipient = Column(String(255), nullable=True)
    subject = Column(String(500), nullable=False)
    body_text = Column(Text, nullable=False)
    received_at = Column(DateTime, default=datetime.utcnow)
    is_processed = Column(Boolean, default=False)

    account = relationship("EmailAccount", back_populates="emails")
    task_candidate = relationship("TaskCandidate", back_populates="email", uselist=False, cascade="all, delete-orphan")


class TaskCandidate(Base):
    """Stores email-extracted task candidates and their lifecycle stage.
    
    Stages:
    - PENDING: Newly ingested email candidate (not yet analyzed by AI).
    - AI_PROCESSED: Analyzed by AI engine with extracted title, summary, dates & link.
    - CREATED: Successfully synced to Notion database.
    - IGNORED: Ignored task candidate (preserves previous_status for clean restoration).
    """
    __tablename__ = "task_candidates"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("email_messages.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=True)
    is_task = Column(Boolean, default=True)
    priority = Column(String(20), nullable=True)       # Select option matching Notion schema (e.g. 'HIGH', 'MEDIUM', 'LOW')
    start_date = Column(String(100), nullable=True)     # ISO YYYY-MM-DD or formatted date string
    deadline = Column(String(100), nullable=True)       # ISO YYYY-MM-DD or formatted due date string
    source_url = Column(String(500), nullable=True)     # Extracted HTTP/HTTPS URL from email message body
    project = Column(String(100), nullable=True)        # e.g. "ESN Poland"
    status = Column(String(20), default="PENDING", index=True)      # 'PENDING', 'AI_PROCESSED', 'CREATED', 'IGNORED'
    previous_status = Column(String(20), nullable=True) # Tracks exact stage prior to IGNORED status for unignoring
    notion_page_id = Column(String(255), nullable=True)
    notion_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    email = relationship("EmailMessage", back_populates="task_candidate")


class NotionConfig(Base):
    """Stores Notion API integration token and target database ID."""
    __tablename__ = "notion_configs"

    id = Column(Integer, primary_key=True, index=True)
    api_token = Column(String(255), nullable=True)
    database_id = Column(String(255), nullable=True)
    database_title = Column(String(255), nullable=True)
    last_schema_json = Column(Text, nullable=True)


class NotionFieldMapping(Base):
    """Stores mapping between TaskCandidate fields and Notion Database properties."""
    __tablename__ = "notion_field_mappings"

    id = Column(Integer, primary_key=True, index=True)
    task_field = Column(String(50), unique=True, nullable=False)  # 'title', 'summary', 'deadline', 'priority', 'project', 'sender', 'email_date', 'source_url', 'importance'
    notion_property_name = Column(String(100), nullable=False)     # Property name in Notion (e.g., 'Task Name')
    notion_property_type = Column(String(50), nullable=False)      # Notion type ('title', 'rich_text', 'date', 'select', 'status', 'url')
    value_mappings_json = Column(Text, nullable=True)             # Options map JSON string


class AISettings(Base):
    """Stores AI engine provider configuration (Mock, OpenAI, Gemini, Groq)."""
    __tablename__ = "ai_settings"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), default="mock")  # 'mock', 'openai', 'gemini', 'groq'
    api_key = Column(String(255), nullable=True)
    model_name = Column(String(100), default="gpt-4o-mini")
    custom_prompt = Column(Text, nullable=True)
