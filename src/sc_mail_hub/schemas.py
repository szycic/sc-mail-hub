from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# --- Task Candidate Schemas ---
class TaskCandidateBase(BaseModel):
    title: str
    summary: Optional[str] = None
    is_task: bool = True
    priority: Optional[str] = None
    start_date: Optional[str] = None
    deadline: Optional[str] = None
    source_url: Optional[str] = None

class TaskCandidateUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    is_task: Optional[bool] = None
    priority: Optional[str] = None
    start_date: Optional[str] = None
    deadline: Optional[str] = None
    source_url: Optional[str] = None
    status: Optional[str] = None

class TaskCandidateOut(TaskCandidateBase):
    id: int
    email_id: Optional[int] = None
    status: str
    notion_page_id: Optional[str] = None
    notion_url: Optional[str] = None
    created_at: datetime
    sender: Optional[str] = None
    recipient: Optional[str] = None
    account_email: Optional[str] = None
    recipient_type: Optional[str] = None
    subject: Optional[str] = None
    received_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

# --- Email Account Schemas ---
class EmailAccountCreate(BaseModel):
    name: str
    provider: str  # 'gmail', 'zoho', 'imap'
    email_address: str
    auth_type: str = "password"  # 'oauth2', 'password'
    credentials_json: Optional[str] = None

class EmailAccountOut(BaseModel):
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
    api_token: str
    database_id: str

class NotionConfigOut(BaseModel):
    id: int
    api_token_configured: bool
    database_id: Optional[str] = None
    database_title: Optional[str] = None
    last_schema_json: Optional[str] = None

class NotionPropertySchema(BaseModel):
    name: str
    type: str
    options: Optional[List[str]] = []

class NotionFieldMappingSchema(BaseModel):
    task_field: str
    notion_property_name: str
    notion_property_type: str
    value_mappings_json: Optional[str] = None

class NotionMappingBatchUpdate(BaseModel):
    mappings: List[NotionFieldMappingSchema]

# --- AI Settings Schemas ---
class AISettingsUpdate(BaseModel):
    provider: str  # 'mock', 'openai', 'gemini'
    api_key: Optional[str] = None
    model_name: Optional[str] = "gpt-4o-mini"
    custom_prompt: Optional[str] = None

class AISettingsOut(BaseModel):
    provider: str
    api_key_configured: bool
    model_name: str
    custom_prompt: Optional[str] = None
