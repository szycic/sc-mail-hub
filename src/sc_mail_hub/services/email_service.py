"""Email Ingestion & PDF Generation Service for SC Mail Hub.

Handles IMAP synchronization, sample ingest seeding, email decoding,
and ReportLab A4 PDF generation with full Polish UTF-8 character support.
"""

import imaplib
import email
import email.utils
import html
import json
import re
import os
import logging
from html.parser import HTMLParser
from email.header import decode_header
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sc_mail_hub.models import EmailAccount, EmailMessage
from sc_mail_hub.config import settings

logger = logging.getLogger("sc_mail_hub.email_service")
logging.basicConfig(level=logging.INFO)

# Preset demo sample emails for rapid testing matching user request diagram
SAMPLE_EMAILS = [
    {
        "sender": "ESN Poland Finance <finance@esnpoland.org>",
        "subject": "Corrected invoice needs to be sent",
        "body": "Hi Szymon,\n\nPlease review the attached updated invoice for the national conference. We need the corrected invoice to be sent to the main sponsor by August 12th.\n\nBest,\nESN Poland Finance Team",
        "date_offset_days": 0
    },
    {
        "sender": "ESN Poland Board <board@esnpoland.org>",
        "subject": "Register for National Assembly",
        "body": "Dear Members,\n\nRegistration for the upcoming ESN Poland National Assembly is now open! Please ensure you register your delegation before August 20th.\n\nLink to form: https://esnpoland.org/na-register\n\nRegards,\nESN Poland Board",
        "date_offset_days": 0
    },
    {
        "sender": "Google Cloud <no-reply@google.com>",
        "subject": "Newsletter from Google: What's new in Cloud & AI",
        "body": "Discover the latest product updates, developer features, and AI announcements from Google Cloud in this month's digest.\n\nRead more on our blog.",
        "date_offset_days": 1
    },
    {
        "sender": "ESN Poland Audit Committee <treasurer@esnpoland.org>",
        "subject": "Submit Q3 Financial Report",
        "body": "Attention Section Treasurers,\n\nAll quarterly expenditure logs and receipt scans must be uploaded to the shared folder prior to August 15th for audit.\n\nThank you,\nESN Poland Audit Committee",
        "date_offset_days": 2
    }
]


def make_clickable_links(text: str) -> str:
    """Detect URLs and email addresses in escaped text and convert them into ReportLab clickable PDF hyperlinks."""
    if not text:
        return ""

    def _replace_url(match):
        url = match.group(0)
        trailing = ""
        while url and url[-1] in '.,;:!?)':
            trailing = url[-1] + trailing
            url = url[:-1]
        escaped_url = html.escape(url)
        return f'<a href="{escaped_url}" color="#2563eb"><u>{escaped_url}</u></a>{trailing}'

    result = re.sub(r'https?://[^\s<>"\'\(\)]+', _replace_url, text)

    def _replace_www(match):
        domain = match.group(0)
        trailing = ""
        while domain and domain[-1] in '.,;:!?)':
            trailing = domain[-1] + trailing
            domain = domain[:-1]
        escaped_domain = html.escape(domain)
        full_url = f"http://{escaped_domain}"
        return f'<a href="{full_url}" color="#2563eb"><u>{escaped_domain}</u></a>{trailing}'

    result = re.sub(r'(?<!href=")(?<!http://)(?<!https://)\bwww\.[a-zA-Z0-9\.-]+\.[a-zA-Z]{2,}(?:/[^\s<>"\'\(\)]*)?', _replace_www, result)

    def _replace_email(match):
        addr = match.group(0)
        trailing = ""
        while addr and addr[-1] in '.,;:!?)':
            trailing = addr[-1] + trailing
            addr = addr[:-1]
        escaped_addr = html.escape(addr)
        return f'<a href="mailto:{escaped_addr}" color="#2563eb"><u>{escaped_addr}</u></a>{trailing}'

    result = re.sub(r'(?<!href=")(?<!mailto:)\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b', _replace_email, result)

    return result


class EmailService:
    _last_sync_stats: Dict[str, Any] = {
        "last_sync_duration_seconds": 0.0,
        "last_synced_at": None,
        "last_error": None,
        "last_fetched_count": 0,
        "cumulative_fetched_today": 0,
        "last_reset_day": None
    }

    @classmethod
    def update_sync_stats(cls, db: Optional[Session] = None, duration: float = 0.0, fetched_count: int = 0, error: Optional[str] = None):
        """Update in-memory and persistent IMAP sync health statistics."""
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if cls._last_sync_stats["last_reset_day"] != today_str:
            cls._last_sync_stats["last_reset_day"] = today_str
            cls._last_sync_stats["cumulative_fetched_today"] = 0

        dur = round(duration, 2)
        if dur <= 0.0:
            dur = 0.05
        cls._last_sync_stats["last_sync_duration_seconds"] = dur
        cls._last_sync_stats["last_synced_at"] = datetime.now(timezone.utc).isoformat()
        cls._last_sync_stats["last_fetched_count"] = fetched_count
        cls._last_sync_stats["cumulative_fetched_today"] += fetched_count

        if error:
            cls._last_sync_stats["last_error"] = error
        else:
            cls._last_sync_stats["last_error"] = None

        if db:
            try:
                from sc_mail_hub.api.admin import get_or_create_system_settings
                sys_set = get_or_create_system_settings(db)
                if sys_set.daily_ingested_date != today_str:
                    sys_set.daily_ingested_date = today_str
                    sys_set.daily_ingested_count = fetched_count
                else:
                    sys_set.daily_ingested_count = (sys_set.daily_ingested_count or 0) + fetched_count
                db.commit()
            except Exception:
                pass

    @classmethod
    def get_sync_health_stats(cls, db: Session, tz_offset: int = 0) -> Dict[str, Any]:
        """Compute live IMAP sync health metrics including today's total ingested emails in user local time."""
        now_utc = datetime.now(timezone.utc)
        now_local = now_utc - timedelta(minutes=tz_offset)
        today_local_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        today_utc_start = (today_local_start + timedelta(minutes=tz_offset)).replace(tzinfo=None)

        today_db_count = db.query(EmailMessage).filter(EmailMessage.received_at >= today_utc_start).count()

        today_str = now_local.strftime("%Y-%m-%d")
        persisted_today = 0
        try:
            from sc_mail_hub.api.admin import get_or_create_system_settings
            sys_set = get_or_create_system_settings(db)
            if sys_set and sys_set.daily_ingested_date == today_str:
                persisted_today = sys_set.daily_ingested_count or 0
        except Exception:
            pass

        emails_today = max(today_db_count, cls._last_sync_stats["cumulative_fetched_today"], persisted_today)

        status = "healthy"
        if cls._last_sync_stats["last_error"]:
            status = "error"

        return {
            "last_sync_duration_seconds": cls._last_sync_stats["last_sync_duration_seconds"],
            "last_synced_at": cls._last_sync_stats["last_synced_at"],
            "emails_fetched_today": emails_today,
            "last_error": cls._last_sync_stats["last_error"],
            "status": status
        }

    @staticmethod
    def test_imap_connection(credentials_json: str) -> Dict[str, Any]:
        """Test IMAP SSL connection with provided credentials JSON."""
        if not credentials_json:
            return {"success": False, "error": "No credentials provided to test connection."}
        try:
            creds = json.loads(credentials_json)
            host = creds.get("host")
            port = int(creds.get("port", 993))
            username = creds.get("username")
            password = creds.get("password")

            if not host or not username or not password:
                return {"success": False, "error": "Missing required host, username, or password credentials."}

            mail = imaplib.IMAP4_SSL(host, port)
            mail.login(username, password)
            mail.logout()
            return {"success": True, "message": f"IMAP SSL connection to {host}:{port} successful!"}
        except Exception as err:
            return {"success": False, "error": f"IMAP Connection Failed: {str(err)}"}
    @staticmethod
    def generate_sample_emails(db: Session, account_id: Optional[int] = None) -> List[EmailMessage]:
        """Inject sample emails into the database for demonstration and testing."""
        created_messages = []
        ts = int(datetime.now(timezone.utc).timestamp())
        for i, sample in enumerate(SAMPLE_EMAILS):
            msg = EmailMessage(
                account_id=account_id,
                message_id=f"sample-{ts}-{i}@sc-mail-hub.local",
                sender=sample["sender"],
                recipient="me@sc-mail-hub.local",
                subject=sample["subject"],
                body_text=sample["body"],
                received_at=datetime.now(timezone.utc),
                is_processed=False
            )
            db.add(msg)
            created_messages.append(msg)
        
        db.commit()
        for m in created_messages:
            db.refresh(m)
        return created_messages

    @staticmethod
    def fetch_from_imap(account: EmailAccount, db: Session) -> List[EmailMessage]:
        """Fetch emails incrementally via IMAP UID regardless of read/unread state."""
        if not account.credentials_json:
            return []
        
        try:
            creds = json.loads(account.credentials_json)
        except Exception:
            return []

        host = creds.get("host")
        port = int(creds.get("port", 993))
        username = creds.get("username", account.email_address)
        password = creds.get("password")

        if not host or not password:
            return []

        fetched_messages = []
        mail = None
        try:
            # Release any open DB read transaction before starting network I/O
            if db:
                try:
                    db.commit()
                except Exception:
                    pass

            logger.info(f"📧 [IMAP] Connecting to {host}:{port} for account '{account.email_address}'...")
            mail = imaplib.IMAP4_SSL(host, port, timeout=settings.IMAP_SOCKET_TIMEOUT_SECONDS)
            mail.login(username, password)
            status, _ = mail.select("inbox")
            if status != "OK":
                logger.error(f"❌ [IMAP] Failed to select INBOX for {account.email_address}")
                mail.logout()
                return []

            logger.info(f"🔑 [IMAP] Successfully logged in to {username}. INBOX selected. Current last_uid: {account.last_uid}")

            current_uid_validity = EmailService._get_uid_validity(mail)
            if account.uid_validity and current_uid_validity and account.uid_validity != current_uid_validity:
                logger.warning(f"⚠️ [IMAP] UIDValidity changed for {account.email_address}. Resetting last_uid.")
                account.last_uid = None

            if account.last_uid is not None and int(account.last_uid) > 0:
                last_uid_int = int(account.last_uid)
                search_clause = f"UID {last_uid_int + 1}:*"
                logger.info(f"🔍 [IMAP] Searching incremental emails with clause: '{search_clause}'")
                status, response = mail.uid("search", search_clause)
                if status != "OK":
                    logger.error(f"❌ [IMAP] Search failed for clause '{search_clause}'")
                    mail.logout()
                    return []
                raw_tokens = response[0].split() if response and response[0] else []
                # Strictly filter out UIDs <= last_uid (prevent IMAP fallback return of last message)
                uid_tokens = [t for t in raw_tokens if t.decode("utf-8", errors="ignore").isdigit() and int(t.decode("utf-8", errors="ignore")) > last_uid_int]
            else:
                logger.info(f"🔍 [IMAP] Initial fetch: searching ALL messages...")
                status, response = mail.uid("search", "ALL")
                if status != "OK":
                    logger.error(f"❌ [IMAP] Initial search ALL failed")
                    mail.logout()
                    return []
                uid_tokens = response[0].split() if response and response[0] else []

            # CRITICAL: Always cap to newest IMAP_MAX_FETCH_PER_SYNC (15) emails max per fetch
            if len(uid_tokens) > settings.IMAP_MAX_FETCH_PER_SYNC:
                logger.info(f"⚡ Capping fetch list from {len(uid_tokens)} to newest {settings.IMAP_MAX_FETCH_PER_SYNC} messages.")
                uid_tokens = uid_tokens[-settings.IMAP_MAX_FETCH_PER_SYNC:]

            max_seen_uid = int(account.last_uid or 0)

            if uid_tokens:
                uid_strs = [t.decode("utf-8", errors="ignore") for t in uid_tokens if t.decode("utf-8", errors="ignore").isdigit()]
                for u_str in uid_strs:
                    max_seen_uid = max(max_seen_uid, int(u_str))

                if uid_strs:
                    uid_sequence = ",".join(uid_strs)
                    logger.info(f"📦 [IMAP] Batch fetching {len(uid_strs)} message(s) (UIDs: {uid_sequence})...")
                    res, msg_data = mail.uid("fetch", uid_sequence, "(BODY.PEEK[])")
                    if res == "OK" and msg_data:
                        for response_part in msg_data:
                            if isinstance(response_part, tuple):
                                msg_bytes = response_part[1]
                                uid_match = re.search(rb'^(\d+)\s*\(', response_part[0])
                                extracted_uid = int(uid_match.group(1).decode("utf-8")) if uid_match else 0

                                msg = email.message_from_bytes(msg_bytes)
                                subject = EmailService._decode_header_str(msg["Subject"])
                                sender = EmailService._decode_header_str(msg["From"])
                                to_header = EmailService._decode_header_str(msg["To"])
                                recipient = to_header if to_header else account.email_address
                                msg_id = msg.get("Message-ID", f"imap-{account.id}-{extracted_uid or max_seen_uid}")

                                body = ""
                                if msg.is_multipart():
                                    for part in msg.walk():
                                        content_type = part.get_content_type()
                                        content_disposition = str(part.get("Content-Disposition"))
                                        if content_type == "text/plain" and "attachment" not in content_disposition:
                                            payload = part.get_payload(decode=True)
                                            if isinstance(payload, bytes):
                                                body = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                                            elif isinstance(payload, str):
                                                body = payload
                                            break
                                else:
                                    payload = msg.get_payload(decode=True)
                                    if isinstance(payload, bytes):
                                        body = payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
                                    elif isinstance(payload, str):
                                        body = payload

                                date_header = msg.get("Date")
                                received_dt = None
                                if date_header:
                                    try:
                                        received_dt = email.utils.parsedate_to_datetime(date_header)
                                    except Exception:
                                        pass
                                if not received_dt:
                                    received_dt = datetime.now(timezone.utc)

                                existing = db.query(EmailMessage).filter(EmailMessage.message_id == msg_id).first()
                                if not existing:
                                    email_record = EmailMessage(
                                        account_id=account.id,
                                        account_email=account.email_address,
                                        email_uid=extracted_uid or max_seen_uid,
                                        message_id=msg_id,
                                        sender=sender,
                                        recipient=recipient,
                                        subject=subject or "No Subject",
                                        body_text=body or subject or "",
                                        received_at=received_dt,
                                        is_processed=False
                                    )
                                    db.add(email_record)
                                    fetched_messages.append(email_record)
                                    logger.info(f"  📥 [IMAP] Downloaded email ID={msg_id} | Subject='{subject}' | From='{sender}'")
                                elif existing.account_id == account.id and not existing.email_uid:
                                    existing.email_uid = extracted_uid or max_seen_uid
            else:
                logger.info(f"ℹ️ [IMAP] No new messages found for {account.email_address}")

            if current_uid_validity:
                account.uid_validity = current_uid_validity
            if max_seen_uid > 0:
                account.last_uid = max_seen_uid
            account.last_synced_at = datetime.now(timezone.utc)
            db.commit()
            logger.info(f"🎉 [IMAP] Sync complete for {account.email_address}: {len(fetched_messages)} new message(s) saved. last_uid={account.last_uid}")
        except Exception as err:
            logger.error(f"❌ [IMAP ERROR] Exception fetching emails for {account.email_address}: {err}", exc_info=True)
        finally:
            if mail:
                try:
                    mail.logout()
                except Exception:
                    pass
        
        return fetched_messages

    @staticmethod
    def _get_uid_validity(mail: imaplib.IMAP4_SSL) -> Optional[str]:
        try:
            typ, data = mail.response("UIDVALIDITY")
            if typ == "UIDVALIDITY" and data and data[0]:
                return data[0].decode("utf-8", errors="ignore")
        except Exception:
            pass
        return None

    @staticmethod
    def _decode_header_str(header_val: str) -> str:
        if not header_val:
            return ""
        decoded_list = decode_header(header_val)
        result = []
        for bytes_or_str, encoding in decoded_list:
            if isinstance(bytes_or_str, bytes):
                result.append(bytes_or_str.decode(encoding or "utf-8", errors="replace"))
            else:
                result.append(str(bytes_or_str))
        return "".join(result)

    @staticmethod
    def get_pdf_dir() -> Path:
        """Get absolute path to static pdfs storage directory."""
        pdf_dir = Path(__file__).resolve().parent.parent / "static" / "pdfs"
        pdf_dir.mkdir(parents=True, exist_ok=True)
        return pdf_dir

    @staticmethod
    def purge_pdf_files(email_id: Optional[int] = None, candidate_id: Optional[int] = None):
        """Delete static PDF file(s) from disk associated with an email message or task candidate."""
        try:
            pdf_dir = EmailService.get_pdf_dir()
            if email_id:
                pdf_file = pdf_dir / f"email_{email_id}.pdf"
                if pdf_file.exists():
                    pdf_file.unlink()
            if candidate_id:
                cand_file = pdf_dir / f"Task_{candidate_id}.pdf"
                if cand_file.exists():
                    cand_file.unlink()
        except Exception as err:
            logger.error(f"Error deleting PDF file: {err}")

    @staticmethod
    def purge_all_pdfs():
        """Delete all generated PDF files from disk."""
        try:
            pdf_dir = EmailService.get_pdf_dir()
            for pdf_file in pdf_dir.glob("*.pdf"):
                if pdf_file.is_file():
                    pdf_file.unlink()
        except Exception as err:
            logger.error(f"Error purging all PDF files: {err}")

    @staticmethod
    def format_email_header_address(
        raw_value: Optional[str],
        fallback_email: Optional[str] = None,
        fallback_name: Optional[str] = None
    ) -> str:
        """Format name and email address so that email address is included in <> next to names.

        Examples:
          - 'John Doe <john@example.com>' -> 'John Doe <john@example.com>'
          - 'John Doe' (with fallback_email='john@example.com') -> 'John Doe <john@example.com>'
          - 'john@example.com' (with fallback_name='John Doe') -> 'John Doe <john@example.com>'
          - 'john@example.com' -> 'john@example.com <john@example.com>'
        """
        if not raw_value or not str(raw_value).strip():
            if fallback_name and fallback_email:
                return f"{fallback_name} <{fallback_email}>"
            elif fallback_email:
                return f"<{fallback_email}>"
            elif fallback_name:
                return fallback_name
            return "Unknown"

        val = str(raw_value).strip()

        # 1. Check if string already contains `<email@domain>` format
        angle_match = re.search(r'<([^>]+)>', val)
        if angle_match:
            email_part = angle_match.group(1).strip()
            name_part = val[:angle_match.start()].strip().strip('"').strip("'")
            if not name_part and fallback_name:
                name_part = fallback_name
            if name_part:
                return f"{name_part} <{email_part}>"
            return f"<{email_part}>"

        # 2. Check if string contains an email address (with @) without angle brackets
        email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', val)
        if email_match:
            email_part = email_match.group(0).strip()
            prefix = val[:email_match.start()].strip().strip('"').strip("'")
            suffix = val[email_match.end():].strip().strip('"').strip("'")
            name_part = f"{prefix} {suffix}".strip()
            if not name_part and fallback_name:
                name_part = fallback_name
            if not name_part:
                name_part = email_part
            return f"{name_part} <{email_part}>"

        # 3. If string is a display name with no email inside
        name_part = val.strip().strip('"').strip("'")
        if fallback_email:
            return f"{name_part} <{fallback_email}>"
        return name_part

    @staticmethod
    def generate_email_pdf(email_msg: EmailMessage) -> str:
        """Generate a clean PDF report of the raw email message supporting Polish characters and return relative URL path."""
        import html
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        pdf_dir = EmailService.get_pdf_dir()
        pdf_filename = f"email_{email_msg.id}.pdf"
        pdf_path = str(pdf_dir / pdf_filename)

        try:
            # Register a TrueType font for Polish and UTF-8 Unicode character support
            font_candidates = [
                "/usr/share/fonts/TTF/DejaVuSans.ttf",
                "/usr/share/fonts/noto/NotoSans-Regular.ttf",
                "/usr/share/fonts/Adwaita/AdwaitaSans-Regular.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                "/usr/share/fonts/truetype/freefont/FreeSans.ttf"
            ]

            pdf_font_name = "Helvetica"
            for f_path in font_candidates:
                p = Path(f_path)
                if p.exists():
                    try:
                        font_alias = f"Unicode_{p.name}"
                        pdfmetrics.registerFont(TTFont(font_alias, str(p)))
                        pdf_font_name = font_alias
                        break
                    except Exception:
                        pass

            subject_text = email_msg.subject or 'No Subject'
            sender_str = EmailService.format_email_header_address(raw_value=email_msg.sender)

            recip_fallback_email = email_msg.account_email or (email_msg.account.email_address if email_msg.account else None)
            recip_fallback_name = email_msg.account.name if (email_msg.account and email_msg.account.name) else None
            recipient_str = EmailService.format_email_header_address(
                raw_value=email_msg.recipient,
                fallback_email=recip_fallback_email,
                fallback_name=recip_fallback_name
            )

            doc = SimpleDocTemplate(
                pdf_path,
                pagesize=A4,
                title=subject_text,
                author=sender_str or "SC Mail Hub",
                leftMargin=36,
                rightMargin=36,
                topMargin=36,
                bottomMargin=36
            )
            styles = getSampleStyleSheet()

            from reportlab.lib.colors import HexColor
            title_style = ParagraphStyle('EmailTitle', parent=styles['Heading1'], fontName=pdf_font_name, fontSize=16, leading=20, textColor=HexColor('#1e293b'))
            meta_style = ParagraphStyle('EmailMeta', parent=styles['Normal'], fontName=pdf_font_name, fontSize=10, leading=14, textColor=HexColor('#64748b'))
            body_style = ParagraphStyle('EmailBody', parent=styles['Normal'], fontName=pdf_font_name, fontSize=11, leading=16, textColor=HexColor('#0f172a'))

            story = []
            story.append(Paragraph(f"<b>Subject:</b> {html.escape(subject_text)}", title_style))
            story.append(Spacer(1, 10))
            story.append(Paragraph(f"<b>From:</b> {make_clickable_links(html.escape(sender_str))}", meta_style))
            story.append(Paragraph(f"<b>To:</b> {make_clickable_links(html.escape(recipient_str))}", meta_style))
            date_str = ""
            if email_msg.received_at:
                dt = email_msg.received_at
                if dt.tzinfo is not None:
                    dt_local = dt.astimezone()
                    tz_name = dt_local.strftime("%Z")
                    if tz_name and tz_name != "UTC":
                        date_str = dt_local.strftime(f"%Y-%m-%d %H:%M {tz_name}")
                    else:
                        date_str = dt_local.strftime("%Y-%m-%d %H:%M")
                else:
                    date_str = dt.strftime("%Y-%m-%d %H:%M")

            story.append(Paragraph(f"<b>Date:</b> {html.escape(date_str)}", meta_style))
            story.append(Spacer(1, 10))
            story.append(HRFlowable(width="100%", thickness=1, color="#cbd5e1", spaceAfter=15))

            body_text = email_msg.body_text or ""
            safe_body = html.escape(body_text)
            safe_body = make_clickable_links(safe_body)
            safe_body = safe_body.replace("\n", "<br/>")
            story.append(Paragraph(safe_body, body_style))

            doc.build(story)
            logger.info(f"📄 Generated PDF for email {email_msg.id}: {pdf_path}")
        except Exception as e:
            logger.error(f"❌ Failed to generate PDF for email {email_msg.id}: {e}")

        return f"/static/pdfs/{pdf_filename}"

