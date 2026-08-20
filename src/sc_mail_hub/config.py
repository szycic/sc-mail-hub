"""Application Configuration Module for SC Mail Hub.

Loads environment variables from .env file or applies defaults for database settings,
IMAP synchronization intervals, server host/port, and default API credentials.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Central settings class holding system environment configuration."""
    PROJECT_NAME: str = "SC Mail Hub"
    VERSION: str = "1.3.2"
    DB_PATH: str = os.getenv("DB_PATH", "data/sc_mail_hub.db")
    DB_URL: str = os.getenv("DB_URL", f"sqlite:///{DB_PATH}")
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    IMAP_MAX_FETCH_PER_SYNC: int = int(os.getenv("IMAP_MAX_FETCH_PER_SYNC", "15"))
    IMAP_SOCKET_TIMEOUT_SECONDS: int = int(os.getenv("IMAP_SOCKET_TIMEOUT_SECONDS", "8"))
    BASE_URL: str = os.getenv("BASE_URL", "http://localhost:8001")
    
    # Default Notion credentials (if set in .env)
    NOTION_API_KEY: str = os.getenv("NOTION_API_KEY", "")
    NOTION_DATABASE_ID: str = os.getenv("NOTION_DATABASE_ID", "")
    
    # Default AI Settings
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")


settings = Settings()
