import imaplib
import email
from email.header import decode_header
from datetime import datetime, timezone
import json
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sc_mail_hub.models import EmailAccount, EmailMessage

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
        """Fetch unread/recent emails via IMAP protocol for Gmail/Zoho/Generic IMAP."""
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
        try:
            mail = imaplib.IMAP4_SSL(host, port)
            mail.login(username, password)
            mail.select("inbox")

            status, response = mail.search(None, "UNSEEN")
            if status != "OK":
                mail.logout()
                return []

            email_ids = response[0].split()
            for e_id in email_ids[-15:]:
                res, msg_data = mail.fetch(e_id, "(RFC822)")
                if res != "OK":
                    continue
                for response_part in msg_data:
                    if isinstance(response_part, tuple):
                        msg = email.message_from_bytes(response_part[1])
                        subject = EmailService._decode_header_str(msg["Subject"])
                        sender = EmailService._decode_header_str(msg["From"])
                        msg_id = msg.get("Message-ID", f"imap-{e_id.decode('utf-8')}")

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
            
            mail.logout()
            account.last_synced_at = datetime.now(timezone.utc)
            db.commit()
        except Exception as err:
            print(f"Error fetching IMAP for {account.email_address}: {err}")
        
        return fetched_messages

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
