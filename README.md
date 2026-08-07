# SC Mail Hub

`sc-mail-hub` is a self-hosted FastAPI application and web dashboard that automatically ingests emails from multiple IMAP accounts, extracts actionable task candidates using AI (OpenAI, Google Gemini, Groq, or a built-in heuristic engine), exports formatted PDF copies of emails, and creates structured task items directly in Notion databases with custom field mappings.

Designed for personal or trusted local-network use, SC Mail Hub provides a complete email-to-task pipeline with interactive inbox management, rule-based filtering, browser push notifications, and system health diagnostics.

---

## Key Features

- **Multi-Account IMAP Ingestion**: Connect multiple IMAP email accounts with configurable background polling intervals, automatic UID tracking, socket timeouts, and manual sync triggers.
- **AI Task Candidate Extraction**: Extract task titles, summaries, priorities (`LOW`, `MEDIUM`, `HIGH`, `URGENT`), start/due dates, and source URLs using OpenAI, Google Gemini, Groq, or an offline heuristic fallback engine.
- **Notion Database Integration**: Map email and task fields (Title, Summary, Priority, Due Date, Sender, Email Date, Message URL, PDF Attachment) to custom Notion database properties with configurable value mappings.
- **PDF Email Attachment Export**: Convert raw email messages into clean HTML/PDF attachments and embed them directly into generated Notion database pages.
- **Inbox Pipeline Workflow**: Organize incoming emails through a 4-stage lifecycle (`PENDING` -> `AI_PROCESSED` -> `CREATED` or `IGNORED`). Supports single-item and batch processing, recipient classification (`DIRECT` vs `MAILING_GROUP`), keyword search, and flexible sorting.
- **Automated Auto-Ignore Rules Engine**: Filter out promotional emails, digests, or system alerts before processing using custom rules (`sender_domain`, `sender_contains`, `subject_keyword`, `subject_regex`). Includes default rule seeding, interactive pattern testing, and retroactive rule application.
- **Browser Web Push Notifications**: Integrated VAPID key generation and W3C Web Push notifications to deliver background alert updates to subscribed browsers even when the dashboard tab is inactive or closed.
- **System Diagnostics & Telemetry**: Comprehensive health checks (database integrity, disk storage, background tasks, IMAP connectivity, AI API keys, Notion DB schema, VAPID keys, purge scheduler), 7-day ingestion charts, and live IMAP health stats.
- **Configuration Export & Import**: Backup and restore complete system configurations (IMAP accounts, AI preferences, Notion mappings, auto-ignore rules, admin settings) via JSON files with one-click settings reset capabilities.
- **Automated Retention & Purging**: Background cleanup service automatically purges synced or ignored task candidates and associated PDF files based on configurable retention days.
- **Real-Time WebSocket Streaming**: Stream ingestion job progress and real-time inbox status updates across all connected browser sessions using WebSockets.

---

## Project Structure

```text
sc-mail-hub/
├── data/                    # SQLite database storage & generated PDF exports
├── src/
│   └── sc_mail_hub/
│       ├── api/             # FastAPI REST & WebSocket endpoint routers
│       │   ├── accounts.py      # IMAP account management & credentials testing
│       │   ├── admin.py         # System settings, health stats, diagnostics & export/import
│       │   ├── ai.py            # AI provider settings & email re-analysis
│       │   ├── inbox.py         # Inbox pipeline, batch operations & WebSocket endpoints
│       │   ├── notifications.py # Web Push subscription & VAPID key endpoints
│       │   ├── notion.py        # Notion DB configuration & custom field mappings
│       │   └── rules.py         # Auto-ignore rule creation, testing & execution
│       ├── services/        # Business logic & background services
│       │   ├── ai_service.py    # OpenAI, Gemini, Groq & heuristic task extraction
│       │   ├── email_service.py # IMAP ingestion, MIME parsing & rendering
│       │   ├── notion_service.py# Notion API integration & page creation
│       │   ├── pdf_service.py   # Raw email HTML to PDF generator
│       │   ├── push_service.py  # VAPID & Web Push notification manager
│       │   └── rule_service.py  # Pattern & regex rule evaluation engine
│       ├── static/          # Dashboard CSS stylesheets & modular JavaScript modules
│       ├── templates/       # Jinja2 HTML dashboard templates
│       ├── config.py        # Application environment variables & settings
│       ├── database.py      # SQLAlchemy database session & engine configuration
│       ├── main.py          # FastAPI application entry point & background tasks
│       ├── models.py        # SQLAlchemy ORM models
│       └── schemas.py       # Pydantic request/response validation schemas
├── tests/                   # Pytest suite for API endpoints & service logic
├── pyproject.toml           # Packaging metadata & pytest configuration
├── requirements.txt         # Dependencies list
└── README.md                # Project documentation
```

---

## Environment Variables

The application can be configured via environment variables or a `.env` file in the project root:

| Variable | Purpose | Default |
|---|---|---|
| `DB_PATH` | Path to the local SQLite database file | `data/sc_mail_hub.db` |
| `DB_URL` | SQLAlchemy connection URL for the database | `sqlite:///{DB_PATH}` |
| `HOST` | Bind host address for the FastAPI server | `0.0.0.0` |
| `PORT` | Bind port for the FastAPI server | `8000` |
| `IMAP_MAX_FETCH_PER_SYNC` | Maximum emails fetched per sync cycle per account | `15` |
| `IMAP_SOCKET_TIMEOUT_SECONDS` | Socket timeout in seconds for IMAP operations | `8` |
| `BASE_URL` | Base URL used for rendering assets and generated PDFs | `http://localhost:8001` |
| `NOTION_API_KEY` | Default Notion integration API secret key | `""` |
| `NOTION_DATABASE_ID` | Default target Notion database ID | `""` |
| `OPENAI_API_KEY` | Default OpenAI API key for AI task extraction | `""` |
| `GEMINI_API_KEY` | Default Google Gemini API key for AI task extraction | `""` |

---

## Installation & Setup

### Requirements
- Python 3.10+
- Virtual environment tool (`venv` or `virtualenv`)

### 1. Clone & Setup Environment

```bash
git clone https://github.com/szycic/sc-mail-hub.git
cd sc-mail-hub

python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment Variables (Optional)

Create a `.env` file in the repository root if you wish to override default configuration values:

```env
HOST=0.0.0.0
PORT=8000
NOTION_API_KEY=secret_xxx
NOTION_DATABASE_ID=xxx
OPENAI_API_KEY=sk-xxx
```

---

## Running the Application

Start the server using Python (which reads `HOST` and `PORT` from `.env` or defaults):

```bash
PYTHONPATH=src python -m sc_mail_hub.main
```

Once running, access the web dashboard in your browser:
- **Dashboard UI**: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive OpenAPI Specs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **ReDoc Documentation**: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

---

## Running Tests

Execute the automated test suite with `pytest`:

```bash
pytest
```

To run tests with detailed output:

```bash
pytest -v
```

---

## REST & WebSocket API Reference

All API routes are prefixed under `/api`:

### Inbox & Candidate Operations
| Endpoint | Method | Description |
|---|---|---|
| `/api/inbox/stats` | `GET` | Retrieve inbox summary counts and last sync timestamp |
| `/api/inbox/candidates` | `GET` | List task candidates (supports `status`, `account_id`, `recipient_type`, `sort_by`, `search`, `page`) |
| `/api/inbox/candidates/{candidate_id}` | `PUT` | Update task candidate details (title, summary, priority, due date) |
| `/api/inbox/candidates/{candidate_id}/email` | `GET` | Fetch raw email message preview HTML for candidate |
| `/api/inbox/candidates/{candidate_id}/prepare-task` | `POST` | Run AI task extraction on candidate |
| `/api/inbox/candidates/{candidate_id}/create-task` | `POST` | Create Notion database item and attach rendered email PDF |
| `/api/inbox/candidates/{candidate_id}/ignore` | `POST` | Mark task candidate status as `IGNORED` |
| `/api/inbox/candidates/{candidate_id}/unignore` | `POST` | Restore ignored task candidate back to pipeline |
| `/api/inbox/candidates/{candidate_id}` | `DELETE` | Permanently delete task candidate and email record |
| `/api/inbox/candidates/batch-process` | `POST` | Run AI processing on multiple candidates |
| `/api/inbox/candidates/batch-reprocess` | `POST` | Force re-analysis of multiple candidates with AI |
| `/api/inbox/candidates/batch-ignore` | `POST` | Batch mark multiple candidates as `IGNORED` |
| `/api/inbox/candidates/batch-unignore` | `POST` | Batch restore multiple ignored candidates |
| `/api/inbox/clear-all` | `DELETE` | Purge all inbox candidates, emails, and generated PDFs |
| `/api/inbox/sample-ingest/start` | `POST` | Trigger background email ingestion job |
| `/api/inbox/ws/sample-ingest/{job_id}` | `WebSocket` | Stream real-time progress for email sync job |
| `/api/inbox/ws/sync-updates` | `WebSocket` | Real-time WebSocket connection for inbox and sync status events |

### IMAP Accounts Management
| Endpoint | Method | Description |
|---|---|---|
| `/api/accounts` | `GET` | List all configured IMAP email accounts |
| `/api/accounts` | `POST` | Add a new IMAP email account connection |
| `/api/accounts/{account_id}` | `DELETE` | Remove an email account connection |
| `/api/accounts/{account_id}/sync` | `POST` | Trigger immediate manual email sync for account |
| `/api/accounts/{account_id}/test` | `POST` | Test connection for an existing IMAP account |
| `/api/accounts/test-credentials` | `POST` | Test IMAP credentials without saving |

### Notion Database Integration
| Endpoint | Method | Description |
|---|---|---|
| `/api/notion/config` | `GET` | Fetch Notion connection configuration |
| `/api/notion/config` | `POST` | Update Notion API token and Database ID |
| `/api/notion/fetch-schema` | `POST` | Inspect and return target Notion database schema |
| `/api/notion/task-fields` | `GET` | List available candidate fields for property mapping |
| `/api/notion/mapping` | `GET` | Fetch current property mapping schema |
| `/api/notion/mapping` | `POST` | Save custom field and value mappings for Notion sync |

### AI Settings & Email Analysis
| Endpoint | Method | Description |
|---|---|---|
| `/api/ai/settings` | `GET` | Fetch current AI provider configuration |
| `/api/ai/settings` | `POST` | Update AI provider, model, API keys, and system prompts |
| `/api/ai/reanalyze-email/{email_id}` | `POST` | Re-run AI task analysis on a specific raw email |
| `/api/ai/test` | `POST` | Test connection and credential validity for configured AI provider |

### Auto-Ignore Rules Engine
| Endpoint | Method | Description |
|---|---|---|
| `/api/rules` | `GET` | List all configured auto-ignore rules |
| `/api/rules` | `POST` | Create a new auto-ignore rule (`sender_domain`, `sender_contains`, `subject_keyword`, `subject_regex`) |
| `/api/rules/{rule_id}` | `PUT` | Update an existing auto-ignore rule |
| `/api/rules/{rule_id}` | `DELETE` | Delete a specific auto-ignore rule |
| `/api/rules/all` | `DELETE` | Delete all auto-ignore rules |
| `/api/rules/test` | `POST` | Test sample email sender and subject against active rules |
| `/api/rules/seed-defaults` | `POST` | Load standard preset auto-ignore rules |
| `/api/rules/apply` | `POST` | Retroactively apply active rules to existing inbox candidates |

### Browser Web Push Notifications
| Endpoint | Method | Description |
|---|---|---|
| `/api/notifications/vapid-public-key` | `GET` | Fetch system VAPID public key for browser push subscription |
| `/api/notifications/subscribe` | `POST` | Register client browser Web Push subscription |
| `/api/notifications/unsubscribe` | `POST` | Remove client browser Web Push subscription |
| `/api/notifications/test` | `POST` | Send test Web Push notification to all active client subscriptions |

### System Administration & Diagnostics
| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/settings` | `GET` | Fetch administrative settings (polling, auto-refresh, retention) |
| `/api/admin/settings` | `PUT` | Update administrative settings |
| `/api/admin/sync-health` | `GET` | Fetch live IMAP sync health metrics and indicators |
| `/api/admin/sync-chart-data` | `GET` | Fetch 7-day account ingestion statistics for charting |
| `/api/admin/diagnostics/run` | `POST` | Run automated 8-point system diagnostic health check |
| `/api/admin/config/export` | `GET` | Export entire system configuration as a JSON backup file |
| `/api/admin/config/import` | `POST` | Import and apply system configuration from JSON backup |
| `/api/admin/danger/purge-ignored` | `POST` | Bulk purge all IGNORED task candidates and emails |
| `/api/admin/danger/reset-settings` | `POST` | Reset administrative settings to factory defaults |

---

## Security & Deployment Note

`sc-mail-hub` is designed for personal use and local-network deployments. By default, API endpoints do not require authentication headers. If exposing the application to public networks:
1. Wrap the FastAPI service behind a reverse proxy (such as Nginx, Caddy, or Traefik) with TLS termination.
2. Enforce HTTP Basic Auth, OAuth2, or IP whitelist restrictions at the reverse proxy layer.