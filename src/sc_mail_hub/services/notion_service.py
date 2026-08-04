import httpx
import json
import re
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sc_mail_hub.models import TaskCandidate, EmailMessage, NotionConfig, NotionFieldMapping

NOTION_API_VERSION = "2022-06-28"

def extract_notion_id(val: str) -> str:
    """Extract a 32-character hexadecimal Notion ID from a raw ID, UUID, or full Notion URL (unhyphenated hex)."""
    if not val:
        return ""
    val_clean = val.strip()
    match = re.search(r'([0-9a-fA-F]{8})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{12})', val_clean)
    if match:
        return match.group(0).replace("-", "").lower()
    return val_clean.replace("-", "").strip().lower()

class NotionService:
    @staticmethod
    def get_headers(api_token: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {api_token.strip()}",
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json"
        }

    @staticmethod
    def fetch_database_schema(api_token: str, database_id: str) -> Dict[str, Any]:
        """Fetch database properties and schema from Notion API."""
        clean_db_id = extract_notion_id(database_id)
        candidate_ids = [clean_db_id, clean_db_id.replace("-", "")]
        last_res = None
        
        try:
            with httpx.Client(timeout=10.0) as client:
                for target_id in candidate_ids:
                    url = f"https://api.notion.com/v1/databases/{target_id}"
                    res = client.get(url, headers=NotionService.get_headers(api_token))
                    if res.status_code == 200:
                        last_res = res
                        break
                    last_res = res

                if not last_res or last_res.status_code != 200:
                    error_msg = last_res.json().get("message", last_res.text) if last_res else "Unknown error"
                    return {"success": False, "error": f"Notion API error ({last_res.status_code if last_res else '400'}): {error_msg}"}
                
                data = last_res.json()
                db_title = ""
                if data.get("title") and len(data["title"]) > 0:
                    db_title = data["title"][0].get("plain_text", "")

                properties_out = []
                for prop_name, prop_data in data.get("properties", {}).items():
                    p_type = prop_data.get("type")
                    options = []
                    
                    if p_type == "select" and "select" in prop_data:
                        options = [opt["name"] for opt in prop_data["select"].get("options", [])]
                    elif p_type == "multi_select" and "multi_select" in prop_data:
                        options = [opt["name"] for opt in prop_data["multi_select"].get("options", [])]
                    elif p_type == "status" and "status" in prop_data:
                        options = [opt["name"] for opt in prop_data["status"].get("options", [])]
                    elif p_type == "relation" and "relation" in prop_data:
                        rel_db_id = prop_data["relation"].get("database_id")
                        if rel_db_id:
                            options = NotionService.fetch_related_pages(client, api_token, rel_db_id)

                    properties_out.append({
                        "name": prop_name,
                        "type": p_type,
                        "options": options
                    })

                return {
                    "success": True,
                    "database_title": db_title or "Untitled Database",
                    "properties": properties_out,
                    "raw_schema": data.get("properties", {})
                }
        except Exception as e:
            return {"success": False, "error": f"Failed to connect to Notion: {str(e)}"}

    @staticmethod
    def fetch_related_pages(client: httpx.Client, api_token: str, database_id: str) -> List[Dict[str, str]]:
        """Query related Notion database to fetch page titles and IDs for relation properties."""
        clean_db_id = extract_notion_id(database_id)
        url = f"https://api.notion.com/v1/databases/{clean_db_id}/query"
        try:
            res = client.post(url, headers=NotionService.get_headers(api_token), json={"page_size": 100})
            if res.status_code == 200:
                results = res.json().get("results", [])
                pages = []
                for page in results:
                    page_id = page.get("id")
                    title = ""
                    for p_val in page.get("properties", {}).values():
                        if p_val.get("type") == "title" and p_val.get("title"):
                            title = p_val["title"][0].get("plain_text", "")
                            break
                    if page_id:
                        pages.append({"name": title or "Untitled Page", "id": page_id})
                return pages
        except Exception as e:
            print(f"Error fetching related pages for db {database_id}: {e}")
        return []

    @staticmethod
    def create_notion_task(candidate: TaskCandidate, db: Session) -> Dict[str, Any]:
        """Dynamically create Notion page based on active custom field mappings."""
        config = db.query(NotionConfig).first()
        if not config or not config.api_token or not config.database_id:
            return {"success": False, "error": "Notion API key or Database ID is not configured."}

        mappings = db.query(NotionFieldMapping).all()
        if not mappings:
            return {"success": False, "error": "No Notion field mappings configured. Please set up custom field mappings in settings."}

        email_msg = db.query(EmailMessage).filter(EmailMessage.id == candidate.email_id).first() if candidate.email_id else None
        email_date_str = email_msg.received_at.strftime("%Y-%m-%d") if email_msg and email_msg.received_at else ""
        start_date_val = candidate.start_date
        if not start_date_val or not str(start_date_val).strip():
            start_date_val = email_date_str

        # Extract real HTTP/HTTPS URLs from email body (if present)
        http_url = ""
        if email_msg and email_msg.body_text:
            extracted_links = re.findall(r'https?://[^\s<>\"\'\(\)]+', email_msg.body_text)
            for link in extracted_links:
                link_lower = link.lower()
                if not any(ignore_kw in link_lower for ignore_kw in ["unsubscribe", "privacy", "opt-out", "preferences"]):
                    http_url = link
                    break
            if not http_url and extracted_links:
                http_url = extracted_links[0]

        # Generate email PDF copy for attachment mapping
        pdf_attachment_url = ""
        if email_msg:
            from sc_mail_hub.services.email_service import EmailService
            from sc_mail_hub.config import settings
            pdf_rel = EmailService.generate_email_pdf(email_msg)
            base_url = (settings.BASE_URL or "http://localhost:8001").rstrip("/")
            pdf_attachment_url = f"{base_url}{pdf_rel}"

        # Use candidate's reviewed source_url if set, otherwise fallback to extracted http_url
        final_source_url = candidate.source_url if candidate.source_url is not None else http_url

        candidate_values = {
            "title": candidate.title,
            "summary": candidate.summary or "",
            "priority": candidate.priority or "MEDIUM",
            "start_date": start_date_val,
            "deadline": candidate.deadline or "",
            "sender": email_msg.sender if email_msg else "",
            "email_date": email_date_str,
            "source_url": final_source_url,
            "attachment": pdf_attachment_url
        }

        notion_properties = {}

        for mapping in mappings:
            if not mapping.notion_property_name or mapping.notion_property_name == "-- Ignore / None --":
                continue

            raw_val = candidate_values.get(mapping.task_field, "")
            
            if mapping.value_mappings_json and raw_val:
                try:
                    val_map = json.loads(mapping.value_mappings_json)
                    if isinstance(val_map, dict) and raw_val in val_map and val_map[raw_val]:
                        raw_val = val_map[raw_val]
                except Exception:
                    pass

            p_type = mapping.notion_property_type
            p_name = mapping.notion_property_name

            if p_type == "title":
                notion_properties[p_name] = {
                    "title": [{"text": {"content": str(raw_val)[:2000]}}]
                }
            elif p_type == "rich_text":
                if raw_val:
                    notion_properties[p_name] = {
                        "rich_text": [{"text": {"content": str(raw_val)[:2000]}}]
                    }
            elif p_type == "select":
                if raw_val:
                    notion_properties[p_name] = {
                        "select": {"name": str(raw_val)[:100]}
                    }
            elif p_type == "status":
                if raw_val:
                    notion_properties[p_name] = {
                        "status": {"name": str(raw_val)[:100]}
                    }
            elif p_type == "date":
                if raw_val:
                    date_iso = NotionService._format_date_string(str(raw_val))
                    if date_iso:
                        notion_properties[p_name] = {
                            "date": {"start": date_iso}
                        }
            elif p_type == "url":
                if raw_val and (str(raw_val).startswith("http://") or str(raw_val).startswith("https://")):
                    notion_properties[p_name] = {
                        "url": str(raw_val)[:1000]
                    }
            elif p_type == "files":
                if raw_val:
                    filename = f"Email_{email_msg.id}.pdf" if email_msg else f"Task_{candidate.id}.pdf"
                    notion_properties[p_name] = {
                        "files": [{
                            "name": filename,
                            "type": "external",
                            "external": {"url": str(raw_val)[:1000]}
                        }]
                    }
            elif p_type == "checkbox":
                notion_properties[p_name] = {
                    "checkbox": bool(raw_val)
                }
            elif p_type == "relation":
                if raw_val:
                    page_ids = [extract_notion_id(pid) for pid in str(raw_val).split(",") if extract_notion_id(pid)]
                    rel_payload = [{"id": pid} for pid in page_ids]
                    if rel_payload:
                        notion_properties[p_name] = {"relation": rel_payload}

        if not any(prop.get("title") for prop in notion_properties.values()):
            notion_properties["Name"] = {"title": [{"text": {"content": candidate.title[:2000]}}]}

        clean_db_id = extract_notion_id(config.database_id)
        url = "https://api.notion.com/v1/pages"
        payload = {
            "parent": {"database_id": clean_db_id},
            "properties": notion_properties
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                res = client.post(url, headers=NotionService.get_headers(config.api_token), json=payload)
                if res.status_code in (200, 201):
                    page_data = res.json()
                    page_id = page_data.get("id")
                    notion_url = page_data.get("url")

                    candidate.status = "CREATED"
                    candidate.notion_page_id = page_id
                    candidate.notion_url = notion_url
                    db.commit()
                    db.refresh(candidate)

                    return {
                        "success": True,
                        "notion_page_id": page_id,
                        "notion_url": notion_url
                    }
                else:
                    err_details = res.json().get("message", res.text)
                    return {"success": False, "error": f"Notion API error ({res.status_code}): {err_details}"}
        except Exception as e:
            return {"success": False, "error": f"Notion request exception: {str(e)}"}

    @staticmethod
    def _format_date_string(date_str: str) -> Optional[str]:
        if not date_str:
            return None
        if len(date_str) == 10 and date_str[4] == '-' and date_str[7] == '-':
            return date_str
        
        current_year = datetime.now().year
        month_map = {
            "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
            "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12
        }
        words = date_str.replace("th", "").replace("st", "").replace("nd", "").replace("rd", "").split()
        day = None
        month = None
        for w in words:
            if w.isdigit():
                day = int(w)
            elif w.lower()[:3] in month_map:
                month = month_map[w.lower()[:3]]

        if day and month:
            return f"{current_year:04d}-{month:02d}-{day:02d}"
        return datetime.now().strftime("%Y-%m-%d")
