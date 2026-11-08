"""SQLite Database Backup and Integrity Check Service for SC Mail Hub.

Provides non-blocking online backups using SQLite's native backup API,
automatic rotation of rolling backups (preserving recent snapshots),
and database integrity diagnostics via PRAGMA quick_check.
"""

import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sc_mail_hub.config import settings

logger = logging.getLogger(__name__)


class DatabaseBackupService:
    """Manages SQLite online backups, rotation policies, and integrity checks."""

    @staticmethod
    def get_db_path() -> Path:
        """Resolve database path from configuration."""
        raw_path = getattr(settings, "DB_PATH", "data/sc_mail_hub.db")
        return Path(raw_path).resolve()

    @staticmethod
    def get_backup_dir() -> Path:
        """Resolve and ensure the directory where rolling backups are stored."""
        db_path = DatabaseBackupService.get_db_path()
        backup_dir = db_path.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        return backup_dir

    @classmethod
    def get_configured_retention_days(cls, db: Optional[Any] = None) -> int:
        """Fetch configured backup retention days from SystemSettings, defaulting to 14."""
        if db is not None:
            try:
                from sc_mail_hub.models import SystemSettings
                sys_set = db.query(SystemSettings).first()
                if sys_set and sys_set.backup_retention_days is not None:
                    return max(1, int(sys_set.backup_retention_days))
            except Exception:
                pass

        try:
            from sc_mail_hub.database import get_db, SessionLocal
            from sc_mail_hub.models import SystemSettings
            from sc_mail_hub.main import app
            session_gen = app.dependency_overrides.get(get_db, None)
            if session_gen:
                gen = session_gen()
                temp_db = next(gen)
                try:
                    sys_set = temp_db.query(SystemSettings).first()
                    if sys_set and sys_set.backup_retention_days is not None:
                        return max(1, int(sys_set.backup_retention_days))
                finally:
                    try:
                        next(gen)
                    except StopIteration:
                        pass
            with SessionLocal() as s_db:
                sys_set = s_db.query(SystemSettings).first()
                if sys_set and sys_set.backup_retention_days is not None:
                    return max(1, int(sys_set.backup_retention_days))
        except Exception:
            pass
        return 14

    @classmethod
    def create_backup(cls, retention_days: Optional[int] = None, db: Optional[Any] = None) -> Dict[str, Any]:
        """Create an atomic SQLite backup file using the official online backup API.

        Rotates backups older than retention_days (guaranteeing at least 3 recent backups).
        If retention_days is None, uses the value configured in SystemSettings.
        """
        if retention_days is None:
            retention_days = cls.get_configured_retention_days(db=db)

        src_path = cls.get_db_path()
        if not src_path.exists():
            return {
                "success": False,
                "error": f"Database file does not exist: {src_path}"
            }

        backup_dir = cls.get_backup_dir()
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        target_name = f"sc_mail_hub_{timestamp_str}.db"
        target_path = backup_dir / target_name
        temp_path = backup_dir / f"{target_name}.tmp"

        t0 = time.time()
        try:
            # Native SQLite online backup API is non-locking and safe during concurrent reads/writes
            src_conn = sqlite3.connect(str(src_path), timeout=10.0)
            dst_conn = sqlite3.connect(str(temp_path))
            with dst_conn:
                src_conn.backup(dst_conn, pages=100)
            dst_conn.close()
            src_conn.close()

            # Verify integrity of newly created backup before finalizing
            verify_conn = sqlite3.connect(str(temp_path), timeout=5.0)
            cur = verify_conn.cursor()
            cur.execute("PRAGMA quick_check(1)")
            check_res = cur.fetchone()
            verify_conn.close()

            if not check_res or check_res[0] != "ok":
                if temp_path.exists():
                    temp_path.unlink()
                err_msg = f"Backup verification failed: {check_res}"
                logger.error(f"❌ [DB Backup] {err_msg}")
                return {"success": False, "error": err_msg}

            # Atomic rename into final filename
            temp_path.replace(target_path)
            duration = round(time.time() - t0, 3)
            size_bytes = target_path.stat().st_size
            size_mb = round(size_bytes / (1024 * 1024), 2)

            logger.info(
                f"💾 [DB Backup] Created backup '{target_name}' ({size_mb} MB) in {duration}s."
            )

            # Apply rotation policy
            rotated_count = cls._rotate_backups(backup_dir, retention_days)

            return {
                "success": True,
                "filename": target_name,
                "path": str(target_path),
                "size_mb": size_mb,
                "size_bytes": size_bytes,
                "duration_seconds": duration,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "rotated_old_backups": rotated_count
            }
        except Exception as err:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass
            logger.error(f"❌ [DB Backup] Backup creation failed: {err}")
            return {"success": False, "error": str(err)}

    @classmethod
    def _rotate_backups(cls, backup_dir: Path, retention_days: int) -> int:
        """Remove backup files older than retention_days, preserving at least 3 backups."""
        backups = sorted(
            [f for f in backup_dir.glob("sc_mail_hub_*.db") if f.is_file()],
            key=lambda f: f.stat().st_mtime,
            reverse=True
        )

        # Always keep at least 3 latest backups regardless of age
        if len(backups) <= 3:
            return 0

        cutoff_seconds = time.time() - (retention_days * 86400)
        rotated = 0
        # Check files from index 3 onward
        for old_file in backups[3:]:
            try:
                if old_file.stat().st_mtime < cutoff_seconds:
                    old_file.unlink()
                    rotated += 1
                    logger.info(f"🗑️ [DB Backup] Rotated old backup: {old_file.name}")
            except Exception as e:
                logger.warning(f"Could not remove old backup {old_file.name}: {e}")
        return rotated

    @classmethod
    def check_integrity(cls, db: Optional[Any] = None) -> Dict[str, Any]:
        """Perform a quick integrity check on the active SQLite database."""
        db_path = cls.get_db_path()
        if not db_path.exists():
            return {
                "is_healthy": False,
                "status": "missing",
                "message": f"Database file not found at {db_path}",
                "size_mb": 0.0,
                "retention_days": cls.get_configured_retention_days(db=db),
                "total_backups": 0,
                "last_backup": None
            }

        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5.0)
            cur = conn.cursor()
            cur.execute("PRAGMA quick_check(5)")
            rows = [r[0] for r in cur.fetchall()]

            cur.execute("PRAGMA page_count")
            page_count = cur.fetchone()[0] or 0
            cur.execute("PRAGMA page_size")
            page_size = cur.fetchone()[0] or 4096
            conn.close()

            is_ok = len(rows) == 1 and rows[0] == "ok"
            size_bytes = page_count * page_size
            size_mb = round(size_bytes / (1024 * 1024), 2)

            backup_list = cls.list_backups()
            last_backup = backup_list[0] if backup_list else None

            return {
                "is_healthy": is_ok,
                "status": "healthy" if is_ok else "corrupted",
                "message": "Database passed quick integrity check" if is_ok else f"Check errors: {', '.join(rows)}",
                "quick_check": rows,
                "size_mb": size_mb,
                "retention_days": cls.get_configured_retention_days(db=db),
                "total_backups": len(backup_list),
                "last_backup": last_backup
            }
        except Exception as err:
            logger.error(f"❌ [DB Health] Integrity check failed: {err}")
            return {
                "is_healthy": False,
                "status": "error",
                "message": str(err),
                "size_mb": 0.0,
                "total_backups": 0,
                "last_backup": None
            }

    @classmethod
    def list_backups(cls) -> List[Dict[str, Any]]:
        """List existing backup files sorted newest first."""
        backup_dir = cls.get_backup_dir()
        if not backup_dir.exists():
            return []

        backups = sorted(
            [f for f in backup_dir.glob("sc_mail_hub_*.db") if f.is_file()],
            key=lambda f: f.stat().st_mtime,
            reverse=True
        )

        result = []
        for b in backups:
            try:
                st = b.stat()
                result.append({
                    "filename": b.name,
                    "size_mb": round(st.st_size / (1024 * 1024), 2),
                    "created_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
                })
            except Exception:
                pass
        return result

