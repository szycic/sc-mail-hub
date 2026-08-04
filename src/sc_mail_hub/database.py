"""Database Initialization and Session Management for SC Mail Hub.

Configures SQLAlchemy engine, sessionmaker, base declarative model,
and manages SQLite automatic column migrations.
"""

from pathlib import Path
from sqlalchemy import create_engine, text, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base
from sc_mail_hub.config import settings


def _ensure_sqlite_parent_dir(database_url: str) -> None:
    """Ensure the parent directory for a file-based SQLite database exists."""
    parsed = make_url(database_url)
    if not parsed.drivername.startswith("sqlite"):
        return

    db_file = parsed.database
    if not db_file or db_file == ":memory:":
        return

    Path(db_file).expanduser().parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_parent_dir(settings.DB_URL)

# SQLite configuration requires check_same_thread=False for multithreaded FastAPI requests
connect_args = {"check_same_thread": False} if settings.DB_URL.startswith("sqlite") else {}

engine = create_engine(
    settings.DB_URL,
    connect_args=connect_args,
    echo=False
)

if settings.DB_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=10000")
            cursor.execute("PRAGMA synchronous=NORMAL")
        except Exception:
            pass
        finally:
            cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def init_db():
    """Initialize database tables and execute lightweight SQLite column migrations."""
    from sc_mail_hub import models  # Ensure models are imported
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE task_candidates ADD COLUMN start_date VARCHAR(100)",
            "ALTER TABLE task_candidates ADD COLUMN source_url VARCHAR(500)",
            "ALTER TABLE task_candidates ADD COLUMN previous_status VARCHAR(20)",
            "ALTER TABLE email_accounts ADD COLUMN last_uid INTEGER",
            "ALTER TABLE email_accounts ADD COLUMN uid_validity VARCHAR(64)",
            "ALTER TABLE email_messages ADD COLUMN email_uid INTEGER",
        ]
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass


def get_db():
    """FastAPI Dependency for obtaining a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
