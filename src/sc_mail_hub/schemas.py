"""Pydantic Request and Response Schemas for SC Mail Hub REST API endpoints.

Covers TaskCandidates, EmailAccounts, Notion Integration Config, Field Mappings, and AI Settings.
"""

from pydantic import BaseModel, ConfigDict, Field, field_serializer
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone


def serialize_utc_datetime(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()



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
    updated_at: Optional[datetime] = None
    sender: Optional[str] = None
    recipient: Optional[str] = None
    account_email: Optional[str] = None
    recipient_type: Optional[str] = None  # 'DIRECT' or 'MAILING_GROUP'
    subject: Optional[str] = None
    received_at: Optional[str] = None
    auto_ignored_reason: Optional[str] = None


    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at", "updated_at", mode="plain", check_fields=False)
    def serialize_candidate_dt(self, dt: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(dt)


class BatchCandidatesRequest(BaseModel):
    """Payload for batch operations on candidate IDs."""
    candidate_ids: List[int]


class PaginatedTaskCandidates(BaseModel):
    """Response payload representing paginated task candidate cards."""
    items: List[TaskCandidateOut]
    total: int
    page: int
    page_size: int
    total_pages: int



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

    @field_serializer("created_at", "last_synced_at", mode="plain", check_fields=False)
    def serialize_account_dt(self, dt: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(dt)



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
    model_name: Optional[str] = None
    custom_prompt: Optional[str] = None


class AISettingsOut(BaseModel):
    """Response payload for AI provider settings status."""
    provider: str
    api_key_configured: bool
    model_name: str
    custom_prompt: Optional[str] = None


# --- System & Admin Settings Schemas ---
class SystemSettingsOut(BaseModel):
    """Response payload for administrative system configuration."""
    id: int
    imap_sync_enabled: bool
    imap_sync_interval_seconds: int
    ui_auto_refresh_enabled: bool
    ui_auto_refresh_interval_seconds: int
    auto_purge_synced_enabled: bool
    purge_synced_days: int
    auto_purge_ignored_enabled: bool
    purge_ignored_days: int

    model_config = ConfigDict(from_attributes=True)


class SystemSettingsUpdate(BaseModel):
    """Request payload for updating administrative system configuration."""
    imap_sync_enabled: Optional[bool] = None
    imap_sync_interval_seconds: Optional[int] = Field(None, ge=5, le=86400)
    ui_auto_refresh_enabled: Optional[bool] = None
    ui_auto_refresh_interval_seconds: Optional[int] = Field(None, ge=5, le=86400)
    auto_purge_synced_enabled: Optional[bool] = None
    purge_synced_days: Optional[int] = Field(None, ge=1, le=365)
    auto_purge_ignored_enabled: Optional[bool] = None
    purge_ignored_days: Optional[int] = Field(None, ge=1, le=365)


# --- Auto-Ignore Rule Schemas ---
class AutoIgnoreRuleCreate(BaseModel):
    """Request payload for creating an auto-ignore rule."""
    name: str
    rule_type: str  # 'sender_domain', 'sender_contains', 'subject_keyword', 'subject_regex'
    pattern: str
    is_active: bool = True


class AutoIgnoreRuleUpdate(BaseModel):
    """Request payload for updating an existing auto-ignore rule."""
    name: Optional[str] = None
    rule_type: Optional[str] = None
    pattern: Optional[str] = None
    is_active: Optional[bool] = None


class AutoIgnoreRuleOut(BaseModel):
    """Response payload for an auto-ignore rule."""
    id: int
    name: str
    rule_type: str
    pattern: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RuleTestRequest(BaseModel):
    """Request payload for testing text against auto-ignore rules."""
    sender: Optional[str] = ""
    subject: Optional[str] = ""


class RuleTestResponse(BaseModel):
    """Response payload for auto-ignore rule test."""
    matched: bool
    matched_rule: Optional[AutoIgnoreRuleOut] = None


# --- Push Subscription Schemas ---
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushSubscriptionUnsubscribe(BaseModel):
    endpoint: str


# --- Diagnostic & Config Backup Schemas ---
class DiagnosticCheckResult(BaseModel):
    """Schema for individual component diagnostic check result."""
    name: str
    status: str  # 'success', 'warning', 'failed'
    latency_ms: float
    details: str
    extra: Optional[Dict[str, Any]] = None


class SystemDiagnosticsResponse(BaseModel):
    """Response payload for system health diagnostic tool."""
    timestamp: str
    overall_status: str  # 'ok', 'warning', 'error'
    total_duration_ms: float
    results: Dict[str, DiagnosticCheckResult]


class ConfigExportPayload(BaseModel):
    """Payload representing exported configuration backup JSON file."""
    version: str = "1.0"
    exported_at: str
    system_settings: Dict[str, Any]
    field_mappings: List[Dict[str, Any]]
    auto_ignore_rules: List[Dict[str, Any]]


class ConfigImportRequest(BaseModel):
    """Payload for importing system configuration backup."""
    system_settings: Optional[Dict[str, Any]] = None
    field_mappings: Optional[List[Dict[str, Any]]] = None
    auto_ignore_rules: Optional[List[Dict[str, Any]]] = None


