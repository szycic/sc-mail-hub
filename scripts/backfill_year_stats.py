#!/usr/bin/env python3
"""One-time script to backfill email ingestion statistics from IMAP for the entire year.

Connects to all active configured IMAP accounts in read-only mode, queries message
INTERNALDATE timestamps since January 1st of the specified year without downloading email bodies,
aggregates daily/hourly counts, and updates the ingestion_stats database table.
"""

import argparse
import email.utils
import imaplib
import json
import logging
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Tuple

# Ensure src/ is on sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "src"))

from sqlalchemy import text
from sc_mail_hub.database import SessionLocal, init_db
from sc_mail_hub.models import EmailAccount

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("backfill_stats")


def backfill_account_stats(
    account: EmailAccount,
    since_date: str = "01-Jan-2026",
    batch_size: int = 500
) -> Dict[Tuple[str, int], int]:
    """Connect to account IMAP in read-only mode and count emails per (date_str, hour_utc)."""
    creds = json.loads(account.credentials_json) if account.credentials_json else {}
    provider = getattr(account, "provider", "gmail")
    default_host = "imap.gmail.com" if provider == "gmail" else "imappro.zoho.com"
    host = creds.get("host", default_host)
    port = int(creds.get("port", 993))
    user = creds.get("username", account.email_address)
    pw = creds.get("password")

    if not pw:
        logger.warning(f"⚠️ Account {account.name} has no password configured. Skipping.")
        return {}

    logger.info(f"📧 Connecting to {host}:{port} for {account.name} ({account.email_address})...")
    mail = imaplib.IMAP4_SSL(host, port, timeout=20)
    try:
        mail.login(user, pw)
        mail.select("inbox", readonly=True)

        logger.info(f"🔍 Searching messages SINCE {since_date} in INBOX...")
        status, data = mail.uid("search", None, "SINCE", since_date)
        if status != "OK" or not data or not data[0]:
            logger.info(f"ℹ️ No messages found since {since_date} for {account.email_address}.")
            return {}

        uid_tokens = [u.decode("utf-8", errors="ignore") for u in data[0].split() if u]
        total_uids = len(uid_tokens)
        logger.info(f"📬 Found {total_uids} emails since {since_date}. Fetching timestamps in batches of {batch_size}...")

        hourly_counts: Dict[Tuple[str, int], int] = defaultdict(int)
        parsed_count = 0

        for i in range(0, total_uids, batch_size):
            chunk = uid_tokens[i:i + batch_size]
            seq = ",".join(chunk)
            f_status, f_data = mail.uid("fetch", seq, "(INTERNALDATE)")
            if f_status != "OK" or not f_data:
                continue

            for item in f_data:
                raw_text = None
                if isinstance(item, tuple) and item:
                    raw_text = item[0].decode("utf-8", errors="ignore") if isinstance(item[0], bytes) else str(item[0])
                elif isinstance(item, bytes):
                    raw_text = item.decode("utf-8", errors="ignore")

                if not raw_text:
                    continue

                m = re.search(r'INTERNALDATE "([^"]+)"', raw_text)
                if not m:
                    continue

                try:
                    raw_date_str = m.group(1)
                    parsed_dt = email.utils.parsedate_to_datetime(raw_date_str)
                    dt_utc = parsed_dt.astimezone(timezone.utc)
                    date_str = dt_utc.strftime("%Y-%m-%d")
                    hour_utc = dt_utc.hour
                    hourly_counts[(date_str, hour_utc)] += 1
                    parsed_count += 1
                except Exception as ex:
                    pass

            logger.info(f"   [{account.name}] Processed {min(i + batch_size, total_uids)} / {total_uids} emails...")

        logger.info(f"✅ [{account.name}] Successfully extracted timestamps for {parsed_count} emails across {len(hourly_counts)} hourly buckets.")
        return hourly_counts

    finally:
        try:
            mail.logout()
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Backfill ingestion stats from IMAP for the current year.")
    parser.add_argument("--year", type=int, default=2026, help="Target year to backfill (default: 2026)")
    parser.add_argument("--batch-size", type=int, default=500, help="IMAP fetch batch size (default: 500)")
    parser.add_argument("--dry-run", action="store_true", help="Count emails without writing to database")
    args = parser.parse_args()

    since_str = f"01-Jan-{args.year}"
    logger.info(f"🚀 Starting one-time ingestion stats backfill from {since_str} (dry_run={args.dry_run})")

    db = SessionLocal()
    try:
        active_accounts = db.query(EmailAccount).filter(EmailAccount.is_active == True).all()
        logger.info(f"Found {len(active_accounts)} active accounts to process.")

        total_stat_entries = 0
        total_emails_counted = 0

        upsert_stmt = text("""
            INSERT INTO ingestion_stats (date_str, hour_utc, account_id, account_email, count)
            VALUES (:date_str, :hour_utc, :account_id, :account_email, :count)
            ON CONFLICT(date_str, hour_utc, account_email)
            DO UPDATE SET count = MAX(ingestion_stats.count, excluded.count)
        """)

        for account in active_accounts:
            t0 = time.time()
            hourly_counts = backfill_account_stats(
                account,
                since_date=since_str,
                batch_size=args.batch_size
            )
            duration = time.time() - t0
            account_total_emails = sum(hourly_counts.values())
            total_emails_counted += account_total_emails

            if not args.dry_run and hourly_counts:
                logger.info(f"💾 Saving {len(hourly_counts)} stat buckets for {account.name} into database...")
                for (date_str, hour_utc), count in hourly_counts.items():
                    db.execute(upsert_stmt, {
                        "date_str": date_str,
                        "hour_utc": hour_utc,
                        "account_id": account.id,
                        "account_email": account.email_address,
                        "count": count
                    })
                db.commit()
                total_stat_entries += len(hourly_counts)

            logger.info(f"✨ Completed {account.name} in {duration:.1f}s ({account_total_emails} emails).")

        logger.info("=" * 60)
        logger.info(f"🎉 Backfill complete! Processed {total_emails_counted} total emails across all accounts.")
        if not args.dry_run:
            logger.info(f"💾 Database updated with {total_stat_entries} ingestion stat records.")

            # Summary stats
            res = db.execute(text("SELECT min(date_str), max(date_str), count(*), sum(count) FROM ingestion_stats")).fetchone()
            if res:
                logger.info(f"📊 Current Ingestion Stats Range: {res[0]} to {res[1]} ({res[2]} hourly rows, {res[3]} total emails tracked)")

    finally:
        db.close()


if __name__ == "__main__":
    main()
