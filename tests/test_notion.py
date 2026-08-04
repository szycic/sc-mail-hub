import pytest
from fastapi.testclient import TestClient
from sc_mail_hub.main import app

client = TestClient(app)

def test_notion_config_and_mapping():
    res = client.get("/api/notion/config")
    assert res.status_code == 200
    config_data = res.json()
    assert "api_token_configured" in config_data

    tf_res = client.get("/api/notion/task-fields")
    assert tf_res.status_code == 200
    task_fields = tf_res.json()
    assert len(task_fields) >= 8

    map_res = client.get("/api/notion/mapping")
    assert map_res.status_code == 200
    mappings = map_res.json()
    assert len(mappings) >= 8

    new_mapping = {
        "mappings": [
            {
                "task_field": "title",
                "notion_property_name": "Name",
                "notion_property_type": "title"
            },
            {
                "task_field": "priority",
                "notion_property_name": "Priority",
                "notion_property_type": "select"
            }
        ]
    }
    save_res = client.post("/api/notion/mapping", json=new_mapping)
    assert save_res.status_code == 200

    updated_map_res = client.get("/api/notion/mapping")
    updated = updated_map_res.json()
    title_map = next((m for m in updated if m["task_field"] == "title"), None)
    assert title_map is not None
    assert title_map["notion_property_name"] == "Name"

def test_notion_file_upload_flow(tmp_path):
    import httpx
    from unittest.mock import MagicMock
    from sc_mail_hub.services.notion_service import NotionService

    test_file = tmp_path / "Email_123.pdf"
    test_file.write_bytes(b"%PDF-1.4 test pdf content")

    def mock_post(url, headers=None, json=None, files=None):
        mock_res = MagicMock()
        mock_res.status_code = 200
        if url == "https://api.notion.com/v1/file_uploads":
            mock_res.json.return_value = {"id": "test_upload_id_123"}
        elif "/send" in url:
            mock_res.json.return_value = {"status": "ok"}
        return mock_res

    mock_client = MagicMock(spec=httpx.Client)
    mock_client.post.side_effect = mock_post

    upload_id = NotionService.upload_file(mock_client, "secret_token", test_file, "Email_123.pdf")
    assert upload_id == "test_upload_id_123"

    assert mock_client.post.call_count == 2
    create_call = mock_client.post.call_args_list[0]
    send_call = mock_client.post.call_args_list[1]

    assert create_call[0][0] == "https://api.notion.com/v1/file_uploads"
    assert create_call[1]["json"] == {"mode": "single_part", "filename": "Email_123.pdf"}

    assert create_call[1]["headers"]["Content-Type"] == "application/json"
    assert create_call[1]["headers"]["Notion-Version"] == "2022-06-28"

    assert send_call[0][0] == "https://api.notion.com/v1/file_uploads/test_upload_id_123/send"
    assert "file" in send_call[1]["files"]

def test_admin_settings_update_triggers_sync():
    res = client.get("/api/admin/settings")
    assert res.status_code == 200

    update_res = client.put("/api/admin/settings", json={
        "imap_sync_enabled": True,
        "imap_sync_interval_seconds": 60
    })
    assert update_res.status_code == 200
    data = update_res.json()
    assert data["imap_sync_interval_seconds"] == 60


