from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sc_mail_hub.config import settings

# SQLite configuration requires check_same_thread=False for multithreaded FastAPI requests
connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    echo=False
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def init_db():
    from sc_mail_hub import models  # Ensure models are loaded
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE task_candidates ADD COLUMN start_date VARCHAR(100)"))
            conn.commit()
        except Exception:
            pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
