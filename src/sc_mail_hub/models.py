from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from sc_mail_hub.database import Base

class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    provider = Column(String(50), nullable=False)  # 'gmail', 'zoho', 'imap'
    email_address = Column(String(255), nullable=False)
    auth_type = Column(String(50), default="imap")  # 'oauth2', 'password'
    credentials_json = Column(Text, nullable=True)  # Store JSON with host, port, pass, oauth tokens
    is_active = Column(Boolean, default=True)
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    emails = relationship("EmailMessage", back_populates="account", cascade="all, delete-orphan")

class EmailMessage(Base):
    __tablename__ = "email_messages"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("email_accounts.id"), nullable=True)
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
    __tablename__ = "task_candidates"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("email_messages.id"), nullable=True)
    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=True)
    importance = Column(String(20), default="MEDIUM")  # 'HIGH', 'MEDIUM', 'LOW'
    is_task = Column(Boolean, default=True)
    priority = Column(String(20), default="MEDIUM")    # 'HIGH', 'MEDIUM', 'LOW'
    start_date = Column(String(100), nullable=True)     # e.g. "10 Aug" or "2026-08-10"
    deadline = Column(String(100), nullable=True)       # e.g. "12 Aug" or "2026-08-12"
    project = Column(String(100), nullable=True)        # e.g. "ESN Poland"
    status = Column(String(20), default="PENDING")      # 'PENDING', 'CREATED', 'IGNORED'
    notion_page_id = Column(String(255), nullable=True)
    notion_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    email = relationship("EmailMessage", back_populates="task_candidate")

class NotionConfig(Base):
    __tablename__ = "notion_configs"

    id = Column(Integer, primary_key=True, index=True)
    api_token = Column(String(255), nullable=True)
    database_id = Column(String(255), nullable=True)
    database_title = Column(String(255), nullable=True)
    last_schema_json = Column(Text, nullable=True)

class NotionFieldMapping(Base):
    __tablename__ = "notion_field_mappings"

    id = Column(Integer, primary_key=True, index=True)
    task_field = Column(String(50), unique=True, nullable=False)  # 'title', 'summary', 'deadline', 'priority', 'project', 'sender', 'email_date', 'source_url', 'importance'
    notion_property_name = Column(String(100), nullable=False)     # Property name in Notion (e.g., 'Task Name')
    notion_property_type = Column(String(50), nullable=False)      # Notion type ('title', 'rich_text', 'date', 'select', 'status', 'url')
    value_mappings_json = Column(Text, nullable=True)             # Options map JSON string

class AISettings(Base):
    __tablename__ = "ai_settings"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), default="mock")  # 'mock', 'openai', 'gemini'
    api_key = Column(String(255), nullable=True)
    model_name = Column(String(100), default="gpt-4o-mini")
    custom_prompt = Column(Text, nullable=True)
