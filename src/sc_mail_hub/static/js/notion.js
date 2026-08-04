/**
 * Notion Integration Settings & Field Mapping Controller for SC Mail Hub.
 */

let fetchedNotionProperties = [];
let currentFieldMappings = [];

async function loadNotionConfig() {
  try {
    const res = await fetch("/api/notion/config");
    if (!res.ok) return;

    const data = await res.json();
    const tokenInput = document.getElementById("notion-api-token");
    const dbInput = document.getElementById("notion-db-id");
    const statusEl = document.getElementById("notion-status-badge");

    if (tokenInput && data.api_token_configured) tokenInput.placeholder = "••••••••••••••••••••••••••••••••";
    if (dbInput && data.database_id) dbInput.value = data.database_id;

    if (statusEl) {
      if (data.api_token_configured && data.database_id) {
        statusEl.innerHTML = `<span style="color:#10b981;">✓ Connected (${escapeHtml(data.database_title || 'Notion Database')})</span>`;
      } else {
        statusEl.innerHTML = `<span style="color:#f59e0b;">⚠️ Notion Not Configured</span>`;
      }
    }

    if (data.last_schema_json) {
      try {
        fetchedNotionProperties = JSON.parse(data.last_schema_json) || [];
      } catch (e) { }
    }
    await loadNotionMapping();
  } catch (err) {
    console.error("Notion config error", err);
    loadNotionMapping();
  }
}

async function saveNotionConfig() {
  const apiToken = document.getElementById("notion-api-token").value;
  const dbId = document.getElementById("notion-db-id").value;

  if (!dbId) {
    showToast("Please enter a valid Notion Database ID", "error");
    return;
  }

  showToast("Saving Notion Config & fetching schema...", "info");

  try {
    const res = await fetch("/api/notion/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_token: apiToken, database_id: dbId })
    });

    const data = await res.json();
    if (res.ok) {
      showToast("Notion details saved!", "success");
      loadNotionConfig();
      fetchNotionSchema();
    } else {
      showToast(data.detail || "Error saving config", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function fetchNotionSchema() {
  showToast("Fetching Database Properties from Notion API...", "info");
  try {
    const res = await fetch("/api/notion/fetch-schema", { method: "POST" });
    const data = await res.json();

    if (res.ok && data.properties) {
      fetchedNotionProperties = data.properties;
      showToast(`Found ${data.properties.length} database properties!`, "success");
      loadNotionMapping();
    } else {
      showToast(data.detail || "Failed to fetch schema", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function loadNotionMapping() {
  const container = document.getElementById("mapping-table-body");
  if (!container) return;

  try {
    const res = await fetch("/api/notion/mapping");
    if (!res.ok) return;

    const mappings = await res.json();
    currentFieldMappings = mappings;
    renderMappingTable(mappings);
  } catch (err) {
    console.error("Load mapping error", err);
  }
}

function renderMappingTable(mappings) {
  const container = document.getElementById("mapping-table-body");
  if (!container) return;

  container.innerHTML = mappings.map(m => {
    const propOptionsList = [...fetchedNotionProperties];
    if (m.notion_property_name && !propOptionsList.some(p => p.name === m.notion_property_name)) {
      propOptionsList.push({ name: m.notion_property_name, type: m.notion_property_type || "property" });
    }

    const matchedProp = fetchedNotionProperties.find(p => p.name === m.notion_property_name);
    const availableOptions = matchedProp && matchedProp.options ? matchedProp.options : [];

    const selectOptions = [
      `<option value="">-- Ignore / Do Not Map --</option>`,
      ...propOptionsList.map(p => {
        const isSelected = p.name === m.notion_property_name;
        return `<option value="${escapeHtml(p.name)}" data-type="${p.type}" ${isSelected ? 'selected' : ''}>
          ${escapeHtml(p.name)} (${p.type})
        </option>`;
      })
    ].join("");

    let valMapObj = {};
    if (m.value_mappings_json) {
      try { valMapObj = JSON.parse(m.value_mappings_json) || {}; } catch (e) { }
    }

    const showValMapping = m.task_field === "priority";

    const optionsPillsHtml = availableOptions.length > 0
      ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
           ${availableOptions.map(opt => `<span class="type-pill" style="background:rgba(59,130,246,0.25); color:#93c5fd; font-weight:600; padding:4px 8px; border-radius:4px;">${escapeHtml(opt)}</span>`).join("")}
         </div>`
      : `<span style="font-size:12px; color:var(--text-dim);">No select/status options found for this property. (Default fallback: HIGH, MEDIUM, LOW)</span>`;

    return `
      <tr data-field="${m.task_field}">
        <td>
          <strong style="color:var(--text-main); font-size:14px;">${escapeHtml(m.label)}</strong>
          <div style="font-size:12px; color:var(--text-dim);">${escapeHtml(m.description)}</div>
        </td>
        <td>
          <span class="type-pill">${m.task_field}</span>
        </td>
        <td>
          <select class="select-input property-select" onchange="onPropertySelectChange(this)">
            ${selectOptions}
          </select>

          ${showValMapping ? `
            <div class="val-mapping-box" style="margin-top:8px; padding:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border-color); border-radius:8px;">
              <div style="font-size:12px; font-weight:700; color:var(--text-main); margin-bottom:4px;">
                📌 Mapped Notion Priority Options:
              </div>
              <div class="options-pills-container">${optionsPillsHtml}</div>
            </div>
          ` : ''}
        </td>
        <td class="property-type-cell">
          ${m.notion_property_type ? `<span class="type-pill" style="background:rgba(16,185,129,0.15); color:#6ee7b7;">${m.notion_property_type}</span>` : '<span style="color:var(--text-dim); font-size:12px;">Not Mapped</span>'}
        </td>
      </tr>
    `;
  }).join("");
}

function onPropertySelectChange(selectEl) {
  const row = selectEl.closest("tr");
  const typeCell = row.querySelector(".property-type-cell");
  const selectedOpt = selectEl.options[selectEl.selectedIndex];
  const pType = selectedOpt.getAttribute("data-type") || "";
  const propName = selectEl.value;

  if (pType) {
    typeCell.innerHTML = `<span class="type-pill" style="background:rgba(16,185,129,0.15); color:#6ee7b7;">${pType}</span>`;
  } else {
    typeCell.innerHTML = `<span style="color:var(--text-dim); font-size:12px;">Not Mapped</span>`;
  }

  const pillsContainer = row.querySelector(".options-pills-container");
  if (pillsContainer) {
    const matchedProp = fetchedNotionProperties.find(p => p.name === propName);
    const availableOptions = matchedProp && matchedProp.options ? matchedProp.options : [];
    if (availableOptions.length > 0) {
      pillsContainer.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
          ${availableOptions.map(opt => `<span class="type-pill" style="background:rgba(59,130,246,0.25); color:#93c5fd; font-weight:600; padding:4px 8px; border-radius:4px;">${escapeHtml(opt)}</span>`).join("")}
        </div>
      `;
    } else {
      pillsContainer.innerHTML = `<span style="font-size:12px; color:var(--text-dim);">No select/status options found for this property. (Default fallback: HIGH, MEDIUM, LOW)</span>`;
    }
  }
}

async function saveNotionMapping() {
  const rows = document.querySelectorAll("#mapping-table-body tr");
  const payloadMappings = [];

  rows.forEach(row => {
    const taskField = row.getAttribute("data-field");
    const selectEl = row.querySelector(".property-select");
    const propName = selectEl.value;
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    const propType = selectedOpt.getAttribute("data-type") || "";

    const valInputs = row.querySelectorAll(".val-map-input");
    let valMapObj = {};
    valInputs.forEach(input => {
      const k = input.getAttribute("data-key");
      const v = input.value.trim();
      if (v) valMapObj[k] = v;
    });
    const valueMappingsJson = Object.keys(valMapObj).length > 0 ? JSON.stringify(valMapObj) : null;

    payloadMappings.push({
      task_field: taskField,
      notion_property_name: propName,
      notion_property_type: propType,
      value_mappings_json: valueMappingsJson
    });
  });

  showToast("Saving custom Notion field mappings...", "info");

  try {
    const res = await fetch("/api/notion/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: payloadMappings })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, "success");
    } else {
      showToast("Failed to save mapping", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}
