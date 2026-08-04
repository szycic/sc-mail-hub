import pytest
from fastapi.testclient import TestClient
from sc_mail_hub.main import app

client = TestClient(app)

def test_root_index_and_tab_paths():
    for path in ["/", "/inbox", "/notion", "/accounts", "/ai"]:
        response = client.get(path)
        assert response.status_code == 200
        assert "Mail Hub" in response.text

def test_sample_ingest_and_inbox():
    # 1. Without connected account, should return HTTP 400
    no_acc_res = client.post("/api/inbox/sample-ingest")
    assert no_acc_res.status_code == 400
    assert "No connected email accounts found" in no_acc_res.json()["detail"]

    # 2. Add connected test account
    acc_payload = {
        "name": "Test Account",
        "email_address": "test@sc-mail-hub.local",
        "provider": "generic",
        "imap_host": "imap.example.com",
        "imap_port": 993,
        "password": "secretpassword"
    }
    client.post("/api/accounts", json=acc_payload)

    ingest_res = client.post("/api/inbox/sample-ingest")
    assert ingest_res.status_code == 200
    data = ingest_res.json()
    assert "candidates_created" in data

    inbox_res = client.get("/api/inbox/candidates?status=ALL")
    assert inbox_res.status_code == 200

def test_ignore_candidate():
    inbox_res = client.get("/api/inbox/candidates?status=PENDING")
    candidates = inbox_res.json()
    if candidates:
        cand_id = candidates[0]["id"]
        ignore_res = client.post(f"/api/inbox/candidates/{cand_id}/ignore")
        assert ignore_res.status_code == 200
        assert ignore_res.json()["message"] == "Task candidate marked as ignored"
