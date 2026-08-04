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
