"""Pydantic Request and Response Schemas for SC Mail Hub REST API endpoints.

Covers TaskCandidates, EmailAccounts, Notion Integration Config, Field Mappings, and AI Settings.
"""

from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# --- Task Candidate Schemas ---
class TaskCandidateBase(BaseModel):
    """Base payload for task candidates."""
    title: str
    summary: Optional[str] = None
    is_task: bool = True
    priority: Optional[str] = None
    start_date: Optional[str] = None
    deadline: Optional[str] = None
    source_url: Optional[str] = None


class TaskCandidateUpdate(BaseModel):
    """Payload for updating an existing task candidate prior to Notion export."""
    title: Optional[str] = None
    summary: Optional[str] = None
    is_task: Optional[bool] = None
    priority: Optional[str] = None
    start_date: Optional[str] = None
    deadline: Optional[str] = None
    source_url: Optional[str] = None
    status: Optional[str] = None


class TaskCandidateOut(TaskCandidateBase):
    """Response payload representing a task candidate card in the inbox UI."""
    id: int
    email_id: Optional[int] = None
    status: str
    notion_page_id: Optional[str] = None
    notion_url: Optional[str] = None
    created_at: datetime
    sender: Optional[str] = None
    recipient: Optional[str] = None
    account_email: Optional[str] = None
    recipient_type: Optional[str] = None  # 'DIRECT' or 'MAILING_GROUP'
    subject: Optional[str] = None
    received_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# --- Email Account Schemas ---
class EmailAccountCreate(BaseModel):
    """Request payload for connecting a new IMAP email account."""
    name: str
    provider: str  # 'gmail', 'zoho', 'imap'
    email_address: str
    auth_type: str = "password"  # 'oauth2', 'password'
    credentials_json: Optional[str] = None


class EmailAccountOut(BaseModel):
    """Response payload representing a connected email account."""
    id: int
    name: str
    provider: str
    email_address: str
    auth_type: str
    is_active: bool
    last_synced_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Notion Config & Field Mapping Schemas ---
class NotionConfigUpdate(BaseModel):
    """Request payload for configuring Notion API Token & Database ID."""
    api_token: str
    database_id: str


class NotionConfigOut(BaseModel):
    """Response payload for current Notion integration configuration."""
    id: int
    api_token_configured: bool
    database_id: Optional[str] = None
    database_title: Optional[str] = None
    last_schema_json: Optional[str] = None


class NotionPropertySchema(BaseModel):
    """Schema representing a single database property in Notion."""
    name: str
    type: str
    options: Optional[List[str]] = []


class NotionFieldMappingSchema(BaseModel):
    """Schema for a single field mapping between TaskCandidate and Notion."""
    task_field: str
    notion_property_name: str
    notion_property_type: str
    value_mappings_json: Optional[str] = None


class NotionMappingBatchUpdate(BaseModel):
    """Payload for batch updating Notion field mappings."""
    mappings: List[NotionFieldMappingSchema]


# --- AI Settings Schemas ---
class AISettingsUpdate(BaseModel):
    """Request payload for updating AI provider credentials and settings."""
    provider: str  # 'mock', 'openai', 'gemini', 'groq'
    api_key: Optional[str] = None
    model_name: Optional[str] = "gpt-4o-mini"
    custom_prompt: Optional[str] = None


class AISettingsOut(BaseModel):
    """Response payload for AI provider settings status."""
    provider: str
    api_key_configured: bool
    model_name: str
    custom_prompt: Optional[str] = None
