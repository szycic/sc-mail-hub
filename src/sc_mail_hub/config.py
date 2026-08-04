import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_NAME: str = "SC Mail Hub"
    VERSION: str = "1.0.0"
    DATABASE_PATH: str = os.getenv("DATABASE_PATH") or os.getenv("DB_PATH", "data/sc_mail_hub.db")
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{DATABASE_PATH}")
    POLL_INTERVAL_SECONDS: int = int(os.getenv("POLL_INTERVAL_SECONDS", "300"))
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    IMAP_INITIAL_LOOKBACK_DAYS: int = int(os.getenv("IMAP_INITIAL_LOOKBACK_DAYS", "30"))
    IMAP_MAX_FETCH_PER_SYNC: int = int(os.getenv("IMAP_MAX_FETCH_PER_SYNC", "100"))
    IMAP_SOCKET_TIMEOUT_SECONDS: int = int(os.getenv("IMAP_SOCKET_TIMEOUT_SECONDS", "20"))
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-dev-key-change-in-production")
    
    # Default Notion credentials (if set in .env)
    NOTION_API_KEY: str = os.getenv("NOTION_API_KEY", "")
    NOTION_DATABASE_ID: str = os.getenv("NOTION_DATABASE_ID", "")
    
    # Default AI Settings
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

settings = Settings()
