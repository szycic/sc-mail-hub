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
    res_data = inbox_res.json()
    candidates = res_data.get("items", []) if isinstance(res_data, dict) else res_data
    if candidates:
        cand_id = candidates[0]["id"]
        ignore_res = client.post(f"/api/inbox/candidates/{cand_id}/ignore")
        assert ignore_res.status_code == 200
        assert ignore_res.json()["message"] == "Task candidate marked as ignored"


def test_inbox_stats_endpoint():
    res = client.get("/api/inbox/stats")
    assert res.status_code == 200
    data = res.json()
    assert "counts" in data
    assert "last_synced_at" in data
    assert "PENDING" in data["counts"]


def test_sync_updates_websocket():
    with client.websocket_connect("/api/inbox/ws/sync-updates") as websocket:
        data = websocket.receive_json()
        assert data.get("event") == "initial_stats"
        assert "stats" in data
        assert "last_synced_at" in data


