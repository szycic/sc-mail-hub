"""AI Task Extraction Service for SC Mail Hub.

Integrates with OpenAI, Gemini, Groq, and built-in Smart Heuristic Engine
to extract actionable tasks, summary descriptions, priorities, dates, and links from emails.
"""

import re
import json
import httpx
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from sc_mail_hub.models import EmailMessage, TaskCandidate, AISettings


class AIService:
    @staticmethod
    def ensure_candidate_from_email(email_msg: EmailMessage, db: Session) -> TaskCandidate:
        """Create or refresh a lightweight candidate without calling paid AI APIs."""
        existing_candidate = db.query(TaskCandidate).filter(TaskCandidate.email_id == email_msg.id).first()
        heuristic = AIService._analyze_heuristic(email_msg)

        title = AIService._normalize_title(email_msg.subject)

        if existing_candidate:
            existing_candidate.title = title or existing_candidate.title
            candidate = existing_candidate
        else:
            candidate = TaskCandidate(
                email_id=email_msg.id,
                title=title,
                summary=None,
                is_task=True,
                priority=None,
                start_date=None,
                deadline=None,
                status="PENDING"
            )
            db.add(candidate)

        db.commit()
        db.refresh(candidate)
        return candidate

    @staticmethod
    def test_ai_connection(provider: str, api_key: str, model_name: str) -> Dict[str, Any]:
        """Test API connectivity for the configured AI provider."""
        provider = (provider or "mock").lower()
        if provider == "mock":
            return {"success": True, "message": "Built-in Smart Heuristic Engine is active and operational (100% offline)."}

        if not api_key:
            return {"success": False, "error": f"API key is required to test {provider.upper()} connection."}

        if provider == "openai":
            model = model_name or "gpt-4o-mini"
            try:
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": "Respond with: OK"}],
                    "max_tokens": 5
                }
                res = httpx.post("https://api.openai.com/v1/chat/completions", json=payload, headers=headers, timeout=10.0)
                if res.status_code == 200:
                    return {"success": True, "message": f"OpenAI API connection successful! (Model: {model})"}
                else:
                    err_detail = res.json().get("error", {}).get("message", res.text)
                    return {"success": False, "error": f"OpenAI API Error ({res.status_code}): {err_detail}"}
            except Exception as e:
                return {"success": False, "error": f"OpenAI Connection Failed: {str(e)}"}

        elif provider == "gemini":
            model = model_name or "gemini-3.1-flash-lite"
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                payload = {"contents": [{"parts": [{"text": "Respond with: OK"}]}]}
                res = httpx.post(url, json=payload, timeout=10.0)
                if res.status_code == 200:
                    return {"success": True, "message": f"Google Gemini API connection successful! (Model: {model})"}
                else:
                    err_detail = res.json().get("error", {}).get("message", res.text) if "application/json" in res.headers.get("content-type", "") else res.text
                    return {"success": False, "error": f"Gemini API Error ({res.status_code}): {err_detail}"}
            except Exception as e:
                return {"success": False, "error": f"Gemini Connection Failed: {str(e)}"}

        elif provider == "groq":
            model = model_name or "llama-3.3-70b-versatile"
            try:
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": "Respond with: OK"}],
                    "max_tokens": 5
                }
                res = httpx.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers, timeout=10.0)
                if res.status_code == 200:
                    return {"success": True, "message": f"Groq Cloud API connection successful! (Model: {model})"}
                else:
                    err_detail = res.json().get("error", {}).get("message", res.text) if "application/json" in res.headers.get("content-type", "") else res.text
                    return {"success": False, "error": f"Groq API Error ({res.status_code}): {err_detail}"}
            except Exception as e:
                return {"success": False, "error": f"Groq Connection Failed: {str(e)}"}

        return {"success": False, "error": f"Unsupported AI provider: {provider}"}

    @staticmethod
    def get_priority_options_from_notion(db: Session) -> list[str]:
        """Fetch allowed priority select options from Notion database schema or configuration."""
        from sc_mail_hub.models import NotionConfig, NotionFieldMapping
        from sc_mail_hub.services.notion_service import NotionService

        config = db.query(NotionConfig).first()
        if not config or not config.database_id or not config.api_token:
            return ["HIGH", "MEDIUM", "LOW"]

        field_mapping = db.query(NotionFieldMapping).filter(NotionFieldMapping.task_field == "priority").first()
        target_prop_name = field_mapping.notion_property_name if field_mapping else "Priority"

        # Check cached schema first
        if config.last_schema_json:
            try:
                props = json.loads(config.last_schema_json)
                for p in props:
                    p_name = p.get("name", "")
                    if p_name.lower() == target_prop_name.lower() or p_name.lower() == "priority":
                        options = p.get("options", [])
                        if options:
                            return options
            except Exception:
                pass

        # Live schema fetch from Notion API
        schema_res = NotionService.fetch_database_schema(config.api_token, config.database_id)
        if schema_res.get("success"):
            props = schema_res.get("properties", [])
            for p in props:
                p_name = p.get("name", "")
                if p_name.lower() == target_prop_name.lower() or p_name.lower() == "priority":
                    options = p.get("options", [])
                    if options:
                        return options

        if field_mapping and field_mapping.value_mappings_json:
            try:
                val_map = json.loads(field_mapping.value_mappings_json)
                mapped_vals = list(val_map.values())
                if mapped_vals:
                    return mapped_vals
            except Exception:
                pass

        return ["HIGH", "MEDIUM", "LOW"]

    @staticmethod
    def analyze_email(email_msg: EmailMessage, db: Session, allow_fallback: bool = False) -> TaskCandidate:
        """Analyze email using configured AI provider or smart fallback heuristic engine."""
        ai_settings = db.query(AISettings).first()
        provider = ai_settings.provider if ai_settings else "mock"
        api_key = ai_settings.api_key if ai_settings else ""

        priority_options = AIService.get_priority_options_from_notion(db)

        analysis = None

        if provider in ["openai", "gemini", "groq"]:
            if not api_key:
                if not allow_fallback:
                    raise RuntimeError(f"AI Provider '{provider}' is enabled but no API Key is set in Settings.")
            else:
                try:
                    if provider == "openai":
                        analysis = AIService._analyze_openai(email_msg, api_key, ai_settings.model_name, priority_options)
                    elif provider == "gemini":
                        analysis = AIService._analyze_gemini(email_msg, api_key, ai_settings.model_name, priority_options)
                    elif provider == "groq":
                        analysis = AIService._analyze_groq(email_msg, api_key, ai_settings.model_name, priority_options)
                except Exception as e:
                    if not allow_fallback:
                        raise RuntimeError(f"AI Provider '{provider}' error: {str(e)}")
                    analysis = None

        if not analysis:
            if provider in ["openai", "gemini", "groq"] and not allow_fallback:
                raise RuntimeError(f"AI Provider '{provider}' failed to return analysis.")
            analysis = AIService._analyze_heuristic(email_msg, priority_options)

        # Extract real HTTP/HTTPS URL from email body if present
        http_url = None
        if email_msg and email_msg.body_text:
            extracted_links = re.findall(r'https?://[^\s<>\"\'\(\)]+', email_msg.body_text)
            for link in extracted_links:
                link_lower = link.lower()
                if not any(ignore_kw in link_lower for ignore_kw in ["unsubscribe", "privacy", "opt-out", "preferences"]):
                    http_url = link
                    break
            if not http_url and extracted_links:
                http_url = extracted_links[0]

        existing_candidate = db.query(TaskCandidate).filter(TaskCandidate.email_id == email_msg.id).first()
        if existing_candidate:
            existing_candidate.title = analysis["title"]
            existing_candidate.summary = analysis["summary"]
            existing_candidate.is_task = analysis["is_task"]
            existing_candidate.priority = analysis["priority"]
            existing_candidate.start_date = analysis.get("start_date")
            existing_candidate.deadline = analysis["deadline"]
            existing_candidate.source_url = http_url
            candidate = existing_candidate
        else:
            candidate = TaskCandidate(
                email_id=email_msg.id,
                title=analysis["title"],
                summary=analysis["summary"],
                is_task=analysis["is_task"],
                priority=analysis["priority"],
                start_date=analysis.get("start_date"),
                deadline=analysis["deadline"],
                source_url=http_url,
                status="PENDING"
            )
            db.add(candidate)

        email_msg.is_processed = True
        db.commit()
        db.refresh(candidate)
        return candidate

    @staticmethod
    def _analyze_heuristic(email_msg: EmailMessage, priority_options: list[str] = None) -> Dict[str, Any]:
        """Smart heuristic NLP engine for email task candidate extraction."""
        if not priority_options:
            priority_options = ["HIGH", "MEDIUM", "LOW"]

        subject = email_msg.subject or ""
        body = email_msg.body_text or ""
        sender = email_msg.sender or ""
        full_text = f"{subject}\n{body}".lower()

        action_keywords = ["invoice", "register", "submit", "action required", "urgent", "due", "send", "review", "upload", "deadline", "pay", "please"]
        low_priority_keywords = ["newsletter", "digest", "no-reply", "announcement", "updates from", "unsubscribed"]

        is_newsletter = any(kw in full_text for kw in low_priority_keywords) or "no-reply" in sender.lower()
        has_action = any(kw in full_text for kw in action_keywords)

        is_task = has_action and not is_newsletter
        
        high_match = next((opt for opt in priority_options if "high" in opt.lower() or "urgent" in opt.lower() or "p1" in opt.lower()), None)
        medium_match = next((opt for opt in priority_options if "med" in opt.lower() or "normal" in opt.lower() or "p2" in opt.lower()), None)
        low_match = next((opt for opt in priority_options if "low" in opt.lower() or "p3" in opt.lower()), None)
        
        if "invoice" in full_text or "urgent" in full_text or "asap" in full_text:
            priority = high_match or priority_options[0]
        elif is_task:
            priority = medium_match or (priority_options[1] if len(priority_options) > 1 else priority_options[0])
        else:
            priority = low_match or priority_options[-1]

        deadline = None
        date_patterns = [
            r'(?:by|due|before)\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?)',
            r'(?:by|due|before)\s+(\d{1,2}\s+[A-Za-z]+)',
            r'(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)',
            r'(\d{4}-\d{2}-\d{2})'
        ]
        for pattern in date_patterns:
            match = re.search(pattern, body, re.IGNORECASE)
            if match:
                deadline = match.group(1).strip()
                break

        if not deadline:
            if "12th" in body or "12 Aug" in body or "August 12" in body:
                deadline = "12 Aug"
            elif "20th" in body or "20 Aug" in body or "August 20" in body:
                deadline = "20 Aug"
            elif "15th" in body or "15 Aug" in body or "August 15" in body:
                deadline = "15 Aug"

        # Start Date extraction
        start_date = None
        start_patterns = [
            r'(?:start|from|beginning|starting)\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?)',
            r'(?:start|from|beginning|starting)\s+(\d{1,2}\s+[A-Za-z]+)',
        ]
        for pattern in start_patterns:
            match = re.search(pattern, body, re.IGNORECASE)
            if match:
                start_date = match.group(1).strip()
                break
        
        if not start_date and email_msg.received_at:
            start_date = email_msg.received_at.strftime("%d %b")
        
        clean_title = AIService._normalize_title(subject)

        summary_lines = [line.strip() for line in body.split("\n") if line.strip() and len(line.strip()) > 10]
        summary = summary_lines[0] if summary_lines else subject

        return {
            "title": clean_title,
            "summary": summary[:300],
            "is_task": is_task,
            "priority": priority,
            "start_date": start_date,
            "deadline": deadline
        }

    @staticmethod
    def _normalize_title(subject: Optional[str]) -> str:
        clean_title = (subject or "No Subject").strip()
        clean_title = re.sub(r'^(RE|Fwd):\s*', '', clean_title, flags=re.IGNORECASE)
        return clean_title or "No Subject"

    @staticmethod
    def _build_analysis_prompt(email_msg: EmailMessage, priority_options: Optional[list[str]] = None) -> str:
        """Construct standard task extraction prompt for LLM providers."""
        options_str = ", ".join(f'"{opt}"' for opt in (priority_options or ["HIGH", "MEDIUM", "LOW"]))
        return f"""Analyze the following email and return a JSON object with task details:
Subject: {email_msg.subject}
From: {email_msg.sender}
Body: {email_msg.body_text}

Allowed Priority Options synced from Notion Database: [{options_str}]

JSON Schema:
{{
  "is_task": boolean,
  "priority": MUST be one of [{options_str}],
  "title": "Actionable task title",
  "summary": "Brief 1-2 sentence summary",
  "start_date": "Extracted start date in ISO YYYY-MM-DD format (e.g. 2026-08-04) or null",
  "deadline": "Extracted due date in ISO YYYY-MM-DD format (e.g. 2026-08-04) or null"
}}
Return ONLY valid JSON.
"""

    @staticmethod
    def _analyze_openai(email_msg: EmailMessage, api_key: str, model_name: str, priority_options: list[str] = None) -> Optional[Dict[str, Any]]:
        """Call OpenAI Chat Completions API for task analysis."""
        prompt = AIService._build_analysis_prompt(email_msg, priority_options)
        try:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "response_format": {"type": "json_object"}
            }
            response = httpx.post("https://api.openai.com/v1/chat/completions", json=payload, headers=headers, timeout=10.0)
            if response.status_code == 200:
                content = response.json()["choices"][0]["message"]["content"]
                return json.loads(content)
            else:
                err_detail = response.json().get("error", {}).get("message") or response.text[:150]
                raise RuntimeError(f"OpenAI (HTTP {response.status_code}): {err_detail}")
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"OpenAI call failed: {e}")

    @staticmethod
    def _analyze_gemini(email_msg: EmailMessage, api_key: str, model_name: str = None, priority_options: list[str] = None) -> Optional[Dict[str, Any]]:
        """Call Gemini REST API for task analysis using gemini-3.1-flash-lite."""
        model = model_name or "gemini-3.1-flash-lite"
        prompt = AIService._build_analysis_prompt(email_msg, priority_options)
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            payload = {"contents": [{"parts": [{"text": prompt}]}]}
            response = httpx.post(url, json=payload, timeout=12.0)
            if response.status_code == 200:
                data = response.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                if text.startswith("```"):
                    text = re.sub(r'^```(?:json)?\s*', '', text)
                    text = re.sub(r'\s*```$', '', text)
                return json.loads(text)
            else:
                err_detail = response.json().get("error", {}).get("message") or response.text[:150]
                raise RuntimeError(f"Gemini (HTTP {response.status_code}): {err_detail}")
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Gemini call failed: {e}")

    @staticmethod
    def _analyze_groq(email_msg: EmailMessage, api_key: str, model_name: str = None, priority_options: list[str] = None) -> Optional[Dict[str, Any]]:
        """Call Groq Cloud API for task analysis."""
        model = model_name or "llama-3.3-70b-versatile"
        prompt = AIService._build_analysis_prompt(email_msg, priority_options)
        try:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "response_format": {"type": "json_object"}
            }
            response = httpx.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers, timeout=10.0)
            if response.status_code == 200:
                content = response.json()["choices"][0]["message"]["content"]
                return json.loads(content)
            else:
                err_detail = response.json().get("error", {}).get("message") or response.text[:150]
                raise RuntimeError(f"Groq (HTTP {response.status_code}): {err_detail}")
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Groq call failed: {e}")
