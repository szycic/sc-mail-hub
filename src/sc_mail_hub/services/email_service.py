import imaplib
import email
from email.header import decode_header
from datetime import datetime, timezone, timedelta
import json
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sc_mail_hub.models import EmailAccount, EmailMessage
from sc_mail_hub.config import settings

# Preset demo sample emails for rapid testing matching user request diagram
SAMPLE_EMAILS = [
    {
        "sender": "finance@esnpoland.org",
        "subject": "Corrected invoice needs to be sent",
        "body": "Hi Szymon,\n\nPlease review the attached updated invoice for the national conference. We need the corrected invoice to be sent to the main sponsor by August 12th.\n\nBest,\nESN Poland Finance Team",
        "date_offset_days": 0
    },
    {
        "sender": "board@esnpoland.org",
        "subject": "Register for National Assembly",
        "body": "Dear Members,\n\nRegistration for the upcoming ESN Poland National Assembly is now open! Please ensure you register your delegation before August 20th.\n\nLink to form: https://esnpoland.org/na-register\n\nRegards,\nESN Poland Board",
        "date_offset_days": 0
    },
    {
        "sender": "no-reply@google.com",
        "subject": "Newsletter from Google: What's new in Cloud & AI",
        "body": "Discover the latest product updates, developer features, and AI announcements from Google Cloud in this month's digest.\n\nRead more on our blog.",
        "date_offset_days": 1
    },
    {
        "sender": "treasurer@esnpoland.org",
        "subject": "Submit Q3 Financial Report",
        "body": "Attention Section Treasurers,\n\nAll quarterly expenditure logs and receipt scans must be uploaded to the shared folder prior to August 15th for audit.\n\nThank you,\nESN Poland Audit Committee",
        "date_offset_days": 2
    }
]

class EmailService:
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
    def generate_sample_emails(db: Session, account_id: int = None) -> List[EmailMessage]:
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
            mail = imaplib.IMAP4_SSL(host, port, timeout=settings.IMAP_SOCKET_TIMEOUT_SECONDS)
            mail.login(username, password)
            status, _ = mail.select("inbox")
            if status != "OK":
                mail.logout()
                return []

            current_uid_validity = EmailService._get_uid_validity(mail)
            if account.uid_validity and current_uid_validity and account.uid_validity != current_uid_validity:
                account.last_uid = None

            if account.last_uid is not None:
                search_clause = f"UID {max(1, int(account.last_uid) + 1)}:*"
            else:
                since_date = (datetime.now(timezone.utc) - timedelta(days=max(1, settings.IMAP_INITIAL_LOOKBACK_DAYS))).strftime("%d-%b-%Y")
                search_clause = f'SINCE "{since_date}"'

            status, response = mail.uid("search", None, search_clause)
            if status != "OK":
                mail.logout()
                return []

            uid_tokens = response[0].split() if response and response[0] else []
            if len(uid_tokens) > settings.IMAP_MAX_FETCH_PER_SYNC:
                uid_tokens = uid_tokens[-settings.IMAP_MAX_FETCH_PER_SYNC:]

            max_seen_uid = int(account.last_uid or 0)

            for uid_token in uid_tokens:
                uid_str = uid_token.decode("utf-8", errors="ignore")
                try:
                    uid_int = int(uid_str)
                except Exception:
                    continue

                max_seen_uid = max(max_seen_uid, uid_int)

                res, msg_data = mail.uid("fetch", uid_str, "(RFC822)")
                if res != "OK":
                    continue
                for response_part in msg_data:
                    if isinstance(response_part, tuple):
                        msg = email.message_from_bytes(response_part[1])
                        subject = EmailService._decode_header_str(msg["Subject"])
                        sender = EmailService._decode_header_str(msg["From"])
                        msg_id = msg.get("Message-ID", f"imap-{account.id}-{uid_str}")

                        body = ""
                        if msg.is_multipart():
                            for part in msg.walk():
                                content_type = part.get_content_type()
                                content_disposition = str(part.get("Content-Disposition"))
                                if content_type == "text/plain" and "attachment" not in content_disposition:
                                    payload = part.get_payload(decode=True)
                                    if payload:
                                        body = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                                    break
                        else:
                            payload = msg.get_payload(decode=True)
                            if payload:
                                body = payload.decode(msg.get_content_charset() or "utf-8", errors="replace")

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
                                email_uid=uid_int,
                                message_id=msg_id,
                                sender=sender,
                                recipient=account.email_address,
                                subject=subject or "No Subject",
                                body_text=body or subject or "",
                                received_at=received_dt,
                                is_processed=False
                            )
                            db.add(email_record)
                            fetched_messages.append(email_record)
                        elif existing.account_id == account.id and not existing.email_uid:
                            existing.email_uid = uid_int
            
            if current_uid_validity:
                account.uid_validity = current_uid_validity
            if max_seen_uid > 0:
                account.last_uid = max_seen_uid
            account.last_synced_at = datetime.now(timezone.utc)
            db.commit()
        except Exception as err:
            print(f"Error fetching IMAP for {account.email_address}: {err}")
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
