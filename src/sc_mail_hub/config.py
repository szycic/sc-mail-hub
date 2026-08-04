import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_NAME: str = "SC Mail Hub"
    VERSION: str = "1.0.0"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./sc_mail_hub.db")
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-dev-key-change-in-production")
    
    # Default Notion credentials (if set in .env)
    NOTION_API_KEY: str = os.getenv("NOTION_API_KEY", "")
    NOTION_DATABASE_ID: str = os.getenv("NOTION_DATABASE_ID", "")
    
    # Default AI Settings
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

settings = Settings()
