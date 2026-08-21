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
    candidates = inbox_res.json().get("items", [])
    if candidates:
        updated_at_str = candidates[0]["updated_at"] or candidates[0]["created_at"]
        assert updated_at_str is not None
        assert "+00:00" in updated_at_str or updated_at_str.endswith("Z")


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


def test_imap_date_header_utc_conversion():
    import email.utils
    from datetime import timezone
    parsed_dt = email.utils.parsedate_to_datetime("Fri, 21 Aug 2026 08:15:00 +0200")
    utc_dt = parsed_dt.astimezone(timezone.utc)
    assert utc_dt.hour == 6
    assert utc_dt.minute == 15


def test_sync_updates_websocket():
    with client.websocket_connect("/api/inbox/ws/sync-updates") as websocket:
        data = websocket.receive_json()
        assert data.get("event") == "initial_stats"
        assert "stats" in data
        assert "last_synced_at" in data


def test_ignore_candidate_during_background_sync():
    from sc_mail_hub.main import _run_email_sync
    _run_email_sync()

    inbox_res = client.get("/api/inbox/candidates?status=PENDING")
    res_data = inbox_res.json()
    candidates = res_data.get("items", []) if isinstance(res_data, dict) else res_data
    if candidates:
        cand_id = candidates[0]["id"]
        ignore_res = client.post(f"/api/inbox/candidates/{cand_id}/ignore")
        assert ignore_res.status_code == 200
        assert ignore_res.json()["message"] == "Task candidate marked as ignored"


def test_inbox_candidate_search():
    res = client.get("/api/inbox/candidates?search=test")
    assert res.status_code == 200
    data = res.json()
    assert "items" in data


def test_inbox_candidate_sorting_by_updated_at():
    res_new = client.get("/api/inbox/candidates?sort_by=UPDATED_NEWEST")
    assert res_new.status_code == 200
    assert "items" in res_new.json()

    res_old = client.get("/api/inbox/candidates?sort_by=UPDATED_OLDEST")
    assert res_old.status_code == 200
    assert "items" in res_old.json()


def test_cannot_ignore_or_unignore_synced_candidates():
    from conftest import TestingSessionLocal as SessionLocal
    from sc_mail_hub.models import TaskCandidate

    db = SessionLocal()
    try:
        cand = TaskCandidate(
            title="Synced Task",
            status="CREATED",
            notion_page_id="page_synced_999"
        )
        db.add(cand)
        db.commit()
        cand_id = cand.id
    finally:
        db.close()

    # Single ignore endpoint should return 400
    res = client.post(f"/api/inbox/candidates/{cand_id}/ignore")
    assert res.status_code == 400
    assert "cannot be ignored" in res.json()["detail"].lower()

    # Batch ignore endpoint should skip it
    batch_res = client.post("/api/inbox/candidates/batch-ignore", json={"candidate_ids": [cand_id]})
    assert batch_res.status_code == 200
    assert batch_res.json()["ignored_count"] == 0

    # Single unignore endpoint should return 400
    unignore_res = client.post(f"/api/inbox/candidates/{cand_id}/unignore")
    assert unignore_res.status_code == 400
    assert "cannot be unignored" in unignore_res.json()["detail"].lower()

    # Batch unignore endpoint should skip it
    batch_unignore_res = client.post("/api/inbox/candidates/batch-unignore", json={"candidate_ids": [cand_id]})
    assert batch_unignore_res.status_code == 200
    assert batch_unignore_res.json()["restored_count"] == 0

    db2 = SessionLocal()
    try:
        cand_check = db2.query(TaskCandidate).filter(TaskCandidate.id == cand_id).first()
        assert cand_check is not None
        assert cand_check.status == "CREATED"
    finally:
        db2.close()


def test_disabled_auto_sync_does_not_bump_last_synced_at():
    from sc_mail_hub.main import _run_email_sync
    from conftest import TestingSessionLocal as SessionLocal
    from sc_mail_hub.models import SystemSettings

    db = SessionLocal()
    try:
        sys_set = db.query(SystemSettings).first()
        if not sys_set:
            sys_set = SystemSettings(imap_sync_enabled=False)
            db.add(sys_set)
        else:
            sys_set.imap_sync_enabled = False
        db.commit()
    finally:
        db.close()

    synced = _run_email_sync()
    assert synced is False


def test_service_worker_endpoint():
    res = client.get("/sw.js")
    assert res.status_code == 200
    assert "Service Worker" in res.text


def test_fetch_from_imap_uses_body_peek():
    from unittest.mock import MagicMock, patch
    from sc_mail_hub.services.email_service import EmailService
    from sc_mail_hub.models import EmailAccount
    from conftest import TestingSessionLocal as SessionLocal

    mock_mail = MagicMock()
    mock_mail.select.return_value = ("OK", [b"1"])
    mock_mail.uid.side_effect = [
        ("OK", [b"101"]),  # search UIDs
        ("OK", [(b'101 (UID 101)', b'From: test@example.com\r\nSubject: Test\r\n\r\nHello')])  # fetch result
    ]

    with patch("imaplib.IMAP4_SSL", return_value=mock_mail):
        db = SessionLocal()
        try:
            account = EmailAccount(
                name="Test IMAP Account",
                provider="generic",
                email_address="peek_test@example.com",
                credentials_json='{"host": "imap.example.com", "port": 993, "username": "peek_test", "password": "pass"}'
            )
            db.add(account)
            db.commit()

            EmailService.fetch_from_imap(account, db)

            # Verify that mail.uid("fetch", ...) was called with "(BODY.PEEK[])"
            fetch_calls = [call for call in mock_mail.uid.call_args_list if call[0][0] == "fetch"]
            assert len(fetch_calls) == 1
            assert fetch_calls[0][0][2] == "(BODY.PEEK[])"
        finally:
            db.close()


def test_delete_account_keep_emails():
    from conftest import TestingSessionLocal as SessionLocal
    from sc_mail_hub.models import EmailAccount, EmailMessage, TaskCandidate

    db = SessionLocal()
    acc = EmailAccount(name="Keep Test Acc", provider="generic", email_address="keep@example.com")
    db.add(acc)
    db.commit()

    msg = EmailMessage(account_id=acc.id, sender="sender@test.com", subject="Subj", body_text="Body")
    db.add(msg)
    db.commit()

    cand = TaskCandidate(email_id=msg.id, title="Candidate Title")
    db.add(cand)
    db.commit()

    msg_id = msg.id
    cand_id = cand.id
    acc_id = acc.id

    res = client.delete(f"/api/accounts/{acc_id}?delete_emails=false")
    assert res.status_code == 200

    db.expire_all()
    assert db.query(EmailAccount).filter(EmailAccount.id == acc_id).first() is None
    retained_msg = db.query(EmailMessage).filter(EmailMessage.id == msg_id).first()
    assert retained_msg is not None
    assert retained_msg.account_id is None
    assert db.query(TaskCandidate).filter(TaskCandidate.id == cand_id).first() is not None
    db.close()


def test_delete_account_delete_emails():
    from conftest import TestingSessionLocal as SessionLocal
    from sc_mail_hub.models import EmailAccount, EmailMessage, TaskCandidate

    db = SessionLocal()
    acc = EmailAccount(name="Purge Test Acc", provider="generic", email_address="purge@example.com")
    db.add(acc)
    db.commit()

    msg = EmailMessage(account_id=acc.id, sender="sender@test.com", subject="Purge Subj", body_text="Body")
    db.add(msg)
    db.commit()

    cand = TaskCandidate(email_id=msg.id, title="Purge Candidate Title")
    db.add(cand)
    db.commit()

    msg_id = msg.id
    cand_id = cand.id
    acc_id = acc.id

    res = client.delete(f"/api/accounts/{acc_id}?delete_emails=true")
    assert res.status_code == 200

    db.expire_all()
    assert db.query(EmailAccount).filter(EmailAccount.id == acc_id).first() is None
    assert db.query(EmailMessage).filter(EmailMessage.id == msg_id).first() is None
    assert db.query(TaskCandidate).filter(TaskCandidate.id == cand_id).first() is None
    db.close()


def test_reconnect_account_reassociates_account_id():
    from conftest import TestingSessionLocal as SessionLocal
    from sc_mail_hub.models import EmailAccount, EmailMessage

    db = SessionLocal()
    # Step 1: Create an orphan message with account_email set but account_id = None
    msg = EmailMessage(
        account_id=None,
        account_email="reconnect_test@example.com",
        sender="sender@test.com",
        subject="Reassociate Test",
        body_text="Body"
    )
    db.add(msg)
    db.commit()
    msg_id = msg.id

    try:
        # Step 2: Re-connect an email account with the matching email_address
        res = client.post("/api/accounts", json={
            "name": "Reconnected Account",
            "provider": "generic",
            "email_address": "reconnect_test@example.com",
            "auth_type": "imap",
            "credentials_json": "{}"
        })
        assert res.status_code == 200
        new_acc_id = res.json()["id"]

        # Step 3: Verify the unlinked message's account_id was reassociated to new_acc_id
        db.expire_all()
        reassociated_msg = db.query(EmailMessage).filter(EmailMessage.id == msg_id).first()
        assert reassociated_msg is not None
        assert reassociated_msg.account_id == new_acc_id

        # Clean up created account and test message
        acc = db.query(EmailAccount).filter(EmailAccount.id == new_acc_id).first()
        if acc:
            acc.emails = []
            db.delete(acc)
            db.commit()
    finally:
        db.query(EmailMessage).filter(EmailMessage.id == msg_id).delete(synchronize_session=False)
        db.commit()
        db.close()











