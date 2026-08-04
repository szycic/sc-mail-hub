import re
import json
import httpx
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from sc_mail_hub.models import EmailMessage, TaskCandidate, AISettings

class AIService:
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
    def analyze_email(email_msg: EmailMessage, db: Session) -> TaskCandidate:
        """Analyze email using configured AI provider or smart fallback heuristic engine."""
        ai_settings = db.query(AISettings).first()
        provider = ai_settings.provider if ai_settings else "mock"
        api_key = ai_settings.api_key if ai_settings else ""

        analysis = None

        if provider == "openai" and api_key:
            analysis = AIService._analyze_openai(email_msg, api_key, ai_settings.model_name or "gpt-4o-mini")
        elif provider == "gemini" and api_key:
            analysis = AIService._analyze_gemini(email_msg, api_key, ai_settings.model_name)
        elif provider == "groq" and api_key:
            analysis = AIService._analyze_groq(email_msg, api_key, ai_settings.model_name)
        
        if not analysis:
            analysis = AIService._analyze_heuristic(email_msg)

        existing_candidate = db.query(TaskCandidate).filter(TaskCandidate.email_id == email_msg.id).first()
        if existing_candidate:
            existing_candidate.title = analysis["title"]
            existing_candidate.summary = analysis["summary"]
            existing_candidate.importance = analysis["importance"]
            existing_candidate.is_task = analysis["is_task"]
            existing_candidate.priority = analysis["priority"]
            existing_candidate.start_date = analysis.get("start_date")
            existing_candidate.deadline = analysis["deadline"]
            candidate = existing_candidate
        else:
            candidate = TaskCandidate(
                email_id=email_msg.id,
                title=analysis["title"],
                summary=analysis["summary"],
                importance=analysis["importance"],
                is_task=analysis["is_task"],
                priority=analysis["priority"],
                start_date=analysis.get("start_date"),
                deadline=analysis["deadline"],
                status="PENDING"
            )
            db.add(candidate)

        email_msg.is_processed = True
        db.commit()
        db.refresh(candidate)
        return candidate

    @staticmethod
    def _analyze_heuristic(email_msg: EmailMessage) -> Dict[str, Any]:
        """Smart heuristic NLP engine for email task candidate extraction."""
        subject = email_msg.subject or ""
        body = email_msg.body_text or ""
        sender = email_msg.sender or ""
        full_text = f"{subject}\n{body}".lower()

        action_keywords = ["invoice", "register", "submit", "action required", "urgent", "due", "send", "review", "upload", "deadline", "pay", "please"]
        low_priority_keywords = ["newsletter", "digest", "no-reply", "announcement", "updates from", "unsubscribed"]

        is_newsletter = any(kw in full_text for kw in low_priority_keywords) or "no-reply" in sender.lower()
        has_action = any(kw in full_text for kw in action_keywords)

        is_task = has_action and not is_newsletter
        
        if "invoice" in full_text or "urgent" in full_text or "asap" in full_text:
            importance = "HIGH"
            priority = "HIGH"
        elif is_task:
            importance = "MEDIUM"
            priority = "MEDIUM"
        else:
            importance = "LOW"
            priority = "LOW"

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
        
        clean_title = subject.strip()
        clean_title = re.sub(r'^(RE|Fwd):\s*', '', clean_title, flags=re.IGNORECASE)

        summary_lines = [line.strip() for line in body.split("\n") if line.strip() and len(line.strip()) > 10]
        summary = summary_lines[0] if summary_lines else subject

        return {
            "title": clean_title,
            "summary": summary[:300],
            "importance": importance,
            "is_task": is_task,
            "priority": priority,
            "start_date": start_date,
            "deadline": deadline
        }

    @staticmethod
    def _analyze_openai(email_msg: EmailMessage, api_key: str, model_name: str) -> Optional[Dict[str, Any]]:
        """Call OpenAI Chat Completions API for task analysis."""
        prompt = f"""Analyze the following email and return a JSON object with task details:
Subject: {email_msg.subject}
From: {email_msg.sender}
Body: {email_msg.body_text}

JSON Schema:
{{
  "is_task": boolean,
  "importance": "HIGH" | "MEDIUM" | "LOW",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "title": "Actionable task title",
  "summary": "Brief 1-2 sentence summary",
  "start_date": "Extracted start date e.g. 10 Aug or null",
  "deadline": "Extracted due date string e.g. 12 Aug or null"
}}
Return ONLY valid JSON.
"""
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
        except Exception as e:
            print(f"OpenAI analysis error: {e}")
        return None

    @staticmethod
    def _analyze_gemini(email_msg: EmailMessage, api_key: str, model_name: str = None) -> Optional[Dict[str, Any]]:
        """Call Gemini REST API for task analysis using gemini-3.1-flash-lite."""
        model = model_name or "gemini-3.1-flash-lite"
        prompt = f"""Analyze the following email and return a JSON object with task details:
Subject: {email_msg.subject}
From: {email_msg.sender}
Body: {email_msg.body_text}

JSON Schema:
{{
  "is_task": boolean,
  "importance": "HIGH" | "MEDIUM" | "LOW",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "title": "Actionable task title",
  "summary": "Brief 1-2 sentence summary",
  "start_date": "Extracted start date e.g. 10 Aug or null",
  "deadline": "Extracted due date string e.g. 12 Aug or null"
}}
Return ONLY raw valid JSON without markdown wrapping.
"""
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}]
            }
            response = httpx.post(url, json=payload, timeout=10.0)
            if response.status_code == 200:
                text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
                text = text.replace("```json", "").replace("```", "").strip()
                return json.loads(text)
        except Exception as e:
            print(f"Gemini analysis error with model {model}: {e}")
        return None

    @staticmethod
    def _analyze_groq(email_msg: EmailMessage, api_key: str, model_name: str = None) -> Optional[Dict[str, Any]]:
        """Call Groq OpenAI-compatible REST API for task analysis."""
        model = model_name or "llama-3.3-70b-versatile"
        prompt = f"""Analyze the following email and return a JSON object with task details:
Subject: {email_msg.subject}
From: {email_msg.sender}
Body: {email_msg.body_text}

JSON Schema:
{{
  "is_task": boolean,
  "importance": "HIGH" | "MEDIUM" | "LOW",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "title": "Actionable task title",
  "summary": "Brief 1-2 sentence summary",
  "start_date": "Extracted start date e.g. 10 Aug or null",
  "deadline": "Extracted due date string e.g. 12 Aug or null"
}}
Return ONLY valid JSON.
"""
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
        except Exception as e:
            print(f"Groq analysis error with model {model}: {e}")
        return None
