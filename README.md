# SC Mail Hub

This repository contains the source code for the `sc_mail_hub` package.

The app is a self-hosted FastAPI dashboard and mail processing hub that automatically fetches emails over IMAP, extracts actionable task candidates, enriches tasks using AI (OpenAI, Google Gemini, Groq, or a built-in heuristic fallback), exports PDF copies of emails, and creates tasks in Notion databases with flexible custom field mappings.

It is intended for personal or local-network use and does not include production authentication by default. If you expose the app beyond a trusted LAN, add authentication, TLS, and restrict access to the API endpoints.

## Features

- **Multi-Account IMAP Sync**: Connect and manage multiple email accounts with background polling, automatic UID tracking, and instant manual sync triggers.
- **AI-Powered Task Extraction**: Automatically analyze email body content using OpenAI, Google Gemini, Groq, or local heuristic fallback models to extract task title, summary, priority, start date, deadline, category, and source URLs.
- **Flexible Notion Database Integration**: Map task candidate fields (title, summary, priority, due date, sender, email date, message URL, PDF attachment) to custom Notion database properties with custom value mapping options.
- **PDF Email Attachment Export**: Automatically render raw emails into formatted PDF documents and attach them directly to created Notion task database items.
- **Inbox Pipeline Management**: Structured 4-stage workflow (`PENDING`, `AI_PROCESSED`, `CREATED`, `IGNORED`) with single and batch actions, recipient classification (`DIRECT` vs `MAILING_GROUP`), keyword search, and flexible sorting.
- **Automated Retention & Purging**: Configurable background cleaner that automatically purges synced or ignored tasks and PDF attachments after specified retention days.
- **Live Progress & Auto-Refresh**: WebSocket event streaming for background IMAP ingestion jobs and configurable UI auto-refresh polling intervals.

## Environment Variables

The following environment variables can be set to configure the application:

| Variable | Purpose | Default |
|---|---|---|
| `DB_PATH` | Path to the SQLite database file | `data/sc_mail_hub.db` |
| `DB_URL` | SQLAlchemy connection URL for the database | `sqlite:///{DB_PATH}` |
| `HOST` | Bind host address for the FastAPI server | `0.0.0.0` |
| `PORT` | Bind port for the FastAPI server | `8000` |
| `IMAP_INITIAL_LOOKBACK_DAYS` | Days of historical emails to fetch on initial sync | `1` |
| `IMAP_MAX_FETCH_PER_SYNC` | Maximum emails fetched per sync cycle | `15` |
| `IMAP_SOCKET_TIMEOUT_SECONDS` | Socket timeout in seconds for IMAP operations | `8` |
| `SECRET_KEY` | Application secret key | `super-secret-dev-key-change-in-production` |
| `BASE_URL` | Application base URL used for asset/PDF rendering | `http://localhost:8001` |
| `NOTION_API_KEY` | Default Notion integration API token | `""` |
| `NOTION_DATABASE_ID` | Default target Notion database ID | `""` |
| `OPENAI_API_KEY` | Default OpenAI API key for AI task extraction | `""` |
| `GEMINI_API_KEY` | Default Google Gemini API key for AI task extraction | `""` |

## Installation

To set up the virtual environment and install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows use `.venv\Scripts\activate`
pip install -r requirements.txt
```

## Running

To start the mail hub application, run:

```bash
PYTHONPATH=src python -m uvicorn sc_mail_hub.main:app --host 0.0.0.0 --port 8000
```

Then open the dashboard in your browser at:
```text
http://127.0.0.1:8000
```

## API Endpoints

The hub exposes REST API endpoints under `/api`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/inbox/stats` | `GET` | Fetch inbox statistics and last sync timestamp |
| `/api/inbox/candidates` | `GET` | List task candidates (supports `status`, `account_id`, `recipient_type`, `sort_by`, `search`, `page`) |
| `/api/inbox/candidates/{candidate_id}/email` | `GET` | Preview email message associated with candidate |
| `/api/inbox/candidates/{candidate_id}` | `PUT` | Update candidate attributes |
| `/api/inbox/candidates/{candidate_id}/prepare-task` | `POST` | Run AI task extraction on candidate |
| `/api/inbox/candidates/{candidate_id}/create-task` | `POST` | Export candidate as a new task in Notion |
| `/api/inbox/candidates/{candidate_id}/ignore` | `POST` | Mark candidate as ignored |
| `/api/inbox/candidates/{candidate_id}/unignore` | `POST` | Restore ignored candidate |
| `/api/inbox/candidates/{candidate_id}` | `DELETE` | Remove candidate and corresponding raw email |
| `/api/inbox/candidates/batch-process` | `POST` | Run AI processing on multiple candidates |
| `/api/inbox/candidates/batch-reprocess` | `POST` | Reprocess multiple candidates with AI |
| `/api/inbox/candidates/batch-ignore` | `POST` | Mark multiple candidates as ignored |
| `/api/inbox/candidates/batch-unignore` | `POST` | Restore multiple ignored candidates |
| `/api/inbox/sample-ingest/start` | `POST` | Trigger background email ingestion job |
| `/api/inbox/ws/sample-ingest/{job_id}` | `WebSocket` | Stream real-time progress for email sync job |
| `/api/inbox/clear-all` | `DELETE` | Purge all inbox candidates, emails, and generated PDFs |
| `/api/accounts` | `GET` | List all configured IMAP email accounts |
| `/api/accounts` | `POST` | Add a new IMAP email account connection |
| `/api/accounts/{account_id}` | `DELETE` | Remove an email account connection |
| `/api/accounts/{account_id}/sync` | `POST` | Manually sync emails for a specific account |
| `/api/accounts/{account_id}/test` | `POST` | Test IMAP connection for an existing account |
| `/api/accounts/test-credentials` | `POST` | Test IMAP connection using raw credentials payload |
| `/api/notion/config` | `GET` | Fetch Notion connection configuration |
| `/api/notion/config` | `POST` | Update Notion API token and Database ID |
| `/api/notion/fetch-schema` | `POST` | Fetch properties schema from Notion database |
| `/api/notion/task-fields` | `GET` | List available task candidate fields for mapping |
| `/api/notion/mapping` | `GET` | Fetch current field mapping configuration |
| `/api/notion/mapping` | `POST` | Save custom field mappings for Notion integration |
| `/api/ai/settings` | `GET` | Fetch current AI provider configuration |
| `/api/ai/settings` | `POST` | Update AI provider, model, API key, and prompt settings |
| `/api/ai/reanalyze-email/{email_id}` | `POST` | Re-run AI analysis on a specific raw email |
| `/api/ai/test` | `POST` | Test AI provider connection and API key |
| `/api/admin/settings` | `GET` | Fetch system administration settings |
| `/api/admin/settings` | `PUT` | Update background polling intervals, auto-refresh, and retention rules |