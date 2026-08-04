// SC Mail Hub Frontend Controller

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  loadCandidates();
  await loadNotionConfig();
  loadAccounts();
  loadAISettings();

  // Auto-refresh inbox candidates every 30 seconds
  setInterval(() => {
    loadCandidates(currentStatusFilter);
  }, 30000);
});

function showToast(message, type = "info", persistent = false) {
  const container = document.getElementById("toast-container");
  if (!container) return null;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  let iconHtml = `<span>ℹ️</span>`;
  if (type === "success") iconHtml = `<span>✅</span>`;
  if (type === "error") iconHtml = `<span>❌</span>`;
  if (type === "loading") iconHtml = `<span class="toast-spin">⏳</span>`;

  toast.innerHTML = `<span class="toast-icon-wrap">${iconHtml}</span> <span class="toast-text-msg">${message}</span>`;
  container.appendChild(toast);

  toast.update = function (newMessage, newType = type) {
    let newIconHtml = `<span>ℹ️</span>`;
    if (newType === "success") newIconHtml = `<span>✅</span>`;
    if (newType === "error") newIconHtml = `<span>❌</span>`;
    if (newType === "loading") newIconHtml = `<span class="toast-spin">⏳</span>`;
    toast.className = `toast toast-${newType}`;
    const iconWrap = toast.querySelector(".toast-icon-wrap");
    const textMsg = toast.querySelector(".toast-text-msg");
    if (iconWrap) iconWrap.innerHTML = newIconHtml;
    if (textMsg) textMsg.textContent = newMessage;
  };

  toast.dismiss = function () {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  };

  if (!persistent) {
    setTimeout(() => {
      toast.dismiss();
    }, 4000);
  }

  return toast;
}

function switchTab(tabName, updateHistory = true) {
  const tabs = document.querySelectorAll(".nav-tab");
  const tabToSelect = Array.from(tabs).find(t => t.getAttribute("data-tab") === tabName) || tabs[0];
  const target = tabToSelect ? tabToSelect.getAttribute("data-tab") : "inbox";

  tabs.forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  if (tabToSelect) tabToSelect.classList.add("active");
  const targetEl = document.getElementById(`tab-${target}`);
  if (targetEl) targetEl.classList.add("active");

  if (updateHistory) {
    const newPath = `/${target}`;
    if (window.location.pathname !== newPath) {
      history.pushState({ tab: target }, "", newPath);
    }
  }
}

function getTabFromPath() {
  const path = window.location.pathname.replace(/^\//, "").split("/")[0].toLowerCase();
  const validTabs = ["inbox", "notion", "accounts", "ai"];
  if (validTabs.includes(path)) {
    return path;
  }
  return "inbox";
}

function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      switchTab(target, true);
    });
  });

  window.addEventListener("popstate", (e) => {
    const tab = (e.state && e.state.tab) || getTabFromPath();
    switchTab(tab, false);
  });

  const initialTab = getTabFromPath();
  switchTab(initialTab, false);
}

let currentCandidates = [];

let currentStatusFilter = "PENDING";

async function loadCandidates(statusFilter) {
  if (statusFilter) currentStatusFilter = statusFilter;
  const listEl = document.getElementById("candidates-list");
  if (!listEl) return;

  listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div>Loading task candidates...</div>`;

  try {
    let url = "/api/inbox/candidates";
    if (currentStatusFilter && currentStatusFilter !== "ALL") {
      url += `?status=${currentStatusFilter}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch candidates");

    currentCandidates = await res.json();
    renderCandidates(currentCandidates);
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>Error loading candidates: ${err.message}</div>`;
  }
}

function renderCandidates(candidates) {
  const listEl = document.getElementById("candidates-list");
  if (!listEl) return;

  if (!candidates || candidates.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📥</div>
        <h3>No task candidates found</h3>
        <p>Click <strong>"Load Emails"</strong> or trigger an email sync.</p>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="triggerSampleIngest()">
          ⚡ Load Emails
        </button>
      </div>
    `;
    return;
  }

  listEl.innerHTML = candidates.map(c => {
    const isHigh = c.importance === "HIGH";
    const isMedium = c.importance === "MEDIUM";
    const isLow = c.importance === "LOW";
    const symbol = isHigh ? "●" : isMedium ? "●" : "○";

    const isCreated = c.status === "CREATED";
    const isIgnored = c.status === "IGNORED";

    return `
      <div class="candidate-card ${c.importance.toLowerCase()}-importance" id="candidate-card-${c.id}">
        <div class="candidate-header">
          <div>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom: 6px;">
              <span class="importance-badge ${c.importance}">${symbol} ${c.importance}</span>
              ${c.start_date ? `<span class="meta-item" style="color:#6ee7b7;">🚀 <strong>Start: ${escapeHtml(c.start_date)}</strong></span>` : ''}
              ${c.deadline ? `<span class="meta-item" style="color:#fde047;">📅 <strong>Due: ${escapeHtml(c.deadline)}</strong></span>` : ''}
            </div>
            <h3 class="candidate-title">${escapeHtml(c.title)}</h3>
          </div>
          <div>
            ${isCreated ? `<span class="btn btn-sm btn-outline" style="color:#10b981; border-color:#10b981;">✓ Synced to Notion</span>` : ''}
            ${isIgnored ? `<span class="btn btn-sm btn-outline" style="color:#64748b;">Ignored</span>` : ''}
          </div>
        </div>

        <p class="candidate-summary">${escapeHtml(c.summary || '')}</p>

        <div class="candidate-meta">
          ${c.sender ? `<div>📧 From: <strong>${escapeHtml(c.sender)}</strong></div>` : ''}
          ${c.recipient ? `<div>📥 To: <strong>${escapeHtml(c.recipient)}</strong></div>` : ''}
          ${c.subject ? `<div>✉️ Subject: <i>"${escapeHtml(c.subject)}"</i></div>` : ''}
          ${c.received_at ? `<div>📩 Received: <strong>${escapeHtml(c.received_at)}</strong></div>` : ''}
        </div>

        <div class="candidate-actions">
          ${!isCreated && !isIgnored ? `
            <button class="btn btn-primary btn-sm" onclick="openTaskReviewModal(${c.id})">
              ➕ Add to Notion
            </button>
            <button class="btn btn-outline btn-sm" onclick="ignoreCandidate(${c.id})">
              🚫 Ignore
            </button>
          ` : ''}

          ${isIgnored ? `
            <button class="btn btn-primary btn-sm" onclick="unignoreCandidate(${c.id})">
              🔄 Unignore
            </button>
          ` : ''}

          ${c.notion_url ? `
            <a href="${c.notion_url}" target="_blank" class="btn btn-success btn-sm">
              🔗 View in Notion
            </a>
          ` : ''}

          <button class="btn btn-outline btn-sm" onclick="previewEmail(${c.id})">
            👁️ Preview Email
          </button>

          <button class="btn btn-outline btn-sm" style="color:#ef4444; border-color:rgba(239,68,68,0.4);" onclick="deleteMessage(${c.id})">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function openTaskReviewModal(candidateId) {
  const card = document.getElementById(`candidate-card-${candidateId}`);
  if (card) card.style.opacity = "0.6";

  showToast("Preparing AI summary for your review...", "info");

  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/prepare-task`, {
      method: "POST"
    });
    const data = await res.json();

    if (res.ok) {
      fillTaskReviewForm(data);
      const modal = document.getElementById("task-review-modal");
      if (modal) modal.classList.add("active");
      if (card) card.style.opacity = "1";
    } else {
      showToast(data.detail || "Failed to prepare task", "error");
      if (card) card.style.opacity = "1";
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
    if (card) card.style.opacity = "1";
  }
}

function fillTaskReviewForm(candidate) {
  const idInput = document.getElementById("review-candidate-id");
  const titleInput = document.getElementById("review-title");
  const summaryInput = document.getElementById("review-summary");
  const importanceInput = document.getElementById("review-importance");
  const priorityInput = document.getElementById("review-priority");
  const startDateInput = document.getElementById("review-start-date");
  const deadlineInput = document.getElementById("review-deadline");

  if (idInput) idInput.value = String(candidate.id);
  if (titleInput) titleInput.value = candidate.title || "";
  if (summaryInput) summaryInput.value = candidate.summary || "";
  if (importanceInput) importanceInput.value = candidate.importance || "MEDIUM";
  if (priorityInput) priorityInput.value = candidate.priority || "MEDIUM";
  if (startDateInput) startDateInput.value = candidate.start_date || "";
  if (deadlineInput) deadlineInput.value = candidate.deadline || "";
}

function closeTaskReviewModal(e) {
  if (e && e.target && e.target !== e.currentTarget) return;
  const modal = document.getElementById("task-review-modal");
  if (modal) modal.classList.remove("active");
}

async function submitReviewedTaskToNotion() {
  const candidateId = Number(document.getElementById("review-candidate-id")?.value || 0);
  if (!candidateId) {
    showToast("Missing candidate id", "error");
    return;
  }

  const payload = {
    title: document.getElementById("review-title")?.value || "",
    summary: document.getElementById("review-summary")?.value || "",
    importance: document.getElementById("review-importance")?.value || "MEDIUM",
    priority: document.getElementById("review-priority")?.value || "MEDIUM",
    start_date: document.getElementById("review-start-date")?.value || null,
    deadline: document.getElementById("review-deadline")?.value || null
  };

  showToast("Creating reviewed task in Notion...", "info");

  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/create-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.notion_url) {
      closeTaskReviewModal();
      showToast("Task successfully created in Notion!", "success");
      loadCandidates(currentStatusFilter);
    } else {
      showToast(data.detail || "Failed to create task in Notion", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function ignoreCandidate(candidateId) {
  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/ignore`, {
      method: "POST"
    });
    if (res.ok) {
      showToast("Task candidate ignored", "info");
      loadCandidates(currentStatusFilter);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function unignoreCandidate(candidateId) {
  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/unignore`, {
      method: "POST"
    });
    if (res.ok) {
      showToast("Task candidate restored to pending", "info");
      loadCandidates(currentStatusFilter);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function deleteMessage(candidateId) {
  if (!confirm("Are you sure you want to delete this message?")) return;
  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      showToast("Message deleted", "info");
      loadCandidates(currentStatusFilter);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function previewEmail(candidateId) {
  showToast("Loading email message preview...", "info");
  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/email`);
    if (!res.ok) throw new Error("Failed to load email preview");

    const data = await res.json();
    const subjEl = document.getElementById("modal-email-subject");
    const senderEl = document.getElementById("modal-email-sender");
    const dateEl = document.getElementById("modal-email-date");
    const bodyEl = document.getElementById("modal-email-body");

    if (subjEl) subjEl.textContent = data.subject || "No Subject";
    if (senderEl) senderEl.textContent = data.sender || "Unknown Sender";
    if (dateEl) dateEl.textContent = data.received_at || "";
    if (bodyEl) bodyEl.textContent = data.body_text || "No email body text available.";

    const modal = document.getElementById("email-preview-modal");
    if (modal) modal.classList.add("active");
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function closeEmailPreviewModal(e) {
  if (e && e.target && e.target !== e.currentTarget) return;
  const modal = document.getElementById("email-preview-modal");
  if (modal) modal.classList.remove("active");
}

async function triggerSampleIngest() {
  const loadingToast = showToast("⚡ Stage 1/3: Connecting to IMAP mailboxes...", "loading", true);

  try {
    const startRes = await fetch("/api/inbox/sample-ingest/start", { method: "POST" });
    const startData = await startRes.json();
    if (!startRes.ok || !startData.job_id) {
      if (loadingToast) loadingToast.dismiss();
      showToast(startData.detail || "Failed to start sync job.", "error");
      return;
    }

    const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${wsProto}://${window.location.host}/api/inbox/ws/sample-ingest/${startData.job_id}`;
    const ws = new WebSocket(wsUrl);

    let finished = false;

    ws.onmessage = (evt) => {
      let payload = null;
      try {
        payload = JSON.parse(evt.data);
      } catch (err) {
        return;
      }

      if (payload.message && loadingToast) {
        loadingToast.update(payload.message, "loading");
      }

      if (payload.status === "completed") {
        finished = true;
        if (loadingToast) {
          loadingToast.update("⚡ Stage 3/3: Ready for review and Notion sync...", "success");
          setTimeout(() => loadingToast.dismiss(), 700);
        }
        showToast(payload.message || "Sync finished", "success");
        loadCandidates();
        ws.close();
      }

      if (payload.status === "failed") {
        finished = true;
        if (loadingToast) loadingToast.dismiss();
        showToast(payload.message || "Sync failed", "error");
        if ((payload.message || "").includes("No connected email accounts")) {
          switchTab("accounts");
        }
        ws.close();
      }
    };

    ws.onerror = () => {
      if (finished) return;
      if (loadingToast) loadingToast.dismiss();
      showToast("Sync connection error. Please try again.", "error");
    };

    ws.onclose = () => {
      if (finished) return;
      if (loadingToast) loadingToast.dismiss();
      showToast("Sync connection closed before completion.", "error");
    };
  } catch (err) {
    if (loadingToast) loadingToast.dismiss();
    showToast(`Error: ${err.message}`, "error");
  }
}

async function emptyInbox() {
  if (!confirm("Are you sure you want to delete all messages and empty the inbox?")) return;
  try {
    const res = await fetch("/api/inbox/clear-all", { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Inbox emptied successfully", "info");
      loadCandidates(currentStatusFilter);
    } else {
      showToast(data.detail || "Failed to empty inbox", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function filterInbox(status) {
  document.querySelectorAll(".inbox-filter-btn").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById(`filter-btn-${status}`);
  if (btn) btn.classList.add("active");
  loadCandidates(status);
}

let fetchedNotionProperties = [];

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

    const val1 = escapeHtml(valMapObj["HIGH"] || (m.task_field === "priority" ? "High" : ""));
    const val2 = escapeHtml(valMapObj["MEDIUM"] || (m.task_field === "priority" ? "Medium" : ""));
    const val3 = escapeHtml(valMapObj["LOW"] || (m.task_field === "priority" ? "Low" : ""));

    const optionsPillsHtml = availableOptions.length > 0
      ? `<div style="margin-top:6px; font-size:11px; color:var(--text-dim);">
           <span>Notion Options: </span>
           ${availableOptions.map(opt => `<span class="type-pill" style="cursor:pointer; background:rgba(59,130,246,0.2); margin-right:4px; margin-bottom:4px; display:inline-block;" onclick="copyNotionOptionToInput(this, '${escapeHtml(opt)}')">${escapeHtml(opt)}</span>`).join("")}
         </div>`
      : '';

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
              <div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:6px;">
                🎯 Match Priority Level with Notion Option Names:
              </div>
              <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px;">
                <div>
                  <span style="font-size:11px; color:#ef4444; font-weight:700; display:block; margin-bottom:2px;">HIGH ➔</span>
                  <input type="text" class="text-input val-map-input" data-key="HIGH" value="${val1}" placeholder="e.g. High or 🔴 High" style="padding:4px 8px; font-size:12px;">
                </div>
                <div>
                  <span style="font-size:11px; color:#f59e0b; font-weight:700; display:block; margin-bottom:2px;">MEDIUM ➔</span>
                  <input type="text" class="text-input val-map-input" data-key="MEDIUM" value="${val2}" placeholder="e.g. Medium or 🟡 Medium" style="padding:4px 8px; font-size:12px;">
                </div>
                <div>
                  <span style="font-size:11px; color:#94a3b8; font-weight:700; display:block; margin-bottom:2px;">LOW ➔</span>
                  <input type="text" class="text-input val-map-input" data-key="LOW" value="${val3}" placeholder="e.g. Low or 🟢 Low" style="padding:4px 8px; font-size:12px;">
                </div>
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

function copyNotionOptionToInput(pillEl, valText, nameText) {
  const box = pillEl.closest(".val-mapping-box");
  if (!box) return;
  const inputs = box.querySelectorAll(".val-map-input");
  let targetInput = Array.from(inputs).find(i => document.activeElement === i) || Array.from(inputs).find(i => !i.value) || inputs[0];
  if (targetInput) {
    targetInput.value = valText;
    showToast(`Set "${targetInput.getAttribute('data-key')}" to ${nameText ? `"${nameText}"` : valText}`, "info");
  }
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

  // Update options pills if available
  const pillsContainer = row.querySelector(".options-pills-container");
  if (pillsContainer) {
    const matchedProp = fetchedNotionProperties.find(p => p.name === propName);
    const availableOptions = matchedProp && matchedProp.options ? matchedProp.options : [];
    if (availableOptions.length > 0) {
      pillsContainer.innerHTML = `
        <div style="margin-top:6px; font-size:11px; color:var(--text-dim);">
          <span>Notion Options: </span>
          ${availableOptions.map(opt => `<span class="type-pill" style="cursor:pointer; background:rgba(59,130,246,0.2); margin-right:4px;" onclick="copyNotionOptionToInput(this, '${escapeHtml(opt)}')">${escapeHtml(opt)}</span>`).join("")}
        </div>
      `;
    } else {
      pillsContainer.innerHTML = '';
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

async function loadAccounts() {
  const listEl = document.getElementById("accounts-list");
  if (!listEl) return;

  try {
    const res = await fetch("/api/accounts");
    const accounts = await res.json();

    if (accounts.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No email accounts connected yet.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = accounts.map(a => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(0,0,0,0.2); border-radius:8px; margin-bottom:8px;">
        <div>
          <strong style="color:var(--text-main);">${escapeHtml(a.name)}</strong>
          <span style="font-size:12px; color:var(--text-dim); margin-left:8px;">(${escapeHtml(a.provider).toUpperCase()} - ${escapeHtml(a.email_address)})</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline btn-sm" onclick="testAccountConnection(${a.id})">🔌 Test</button>
          <button class="btn btn-outline btn-sm" onclick="syncAccount(${a.id})">⚡ Sync</button>
          <button class="btn btn-outline btn-sm" style="color:#ef4444;" onclick="deleteAccount(${a.id})">🗑️ Delete</button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Accounts load error", err);
  }
}

async function testAccountConnection(accId) {
  showToast("Testing IMAP SSL connection...", "info");
  try {
    const res = await fetch(`/api/accounts/${accId}/test`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "IMAP SSL connection successful!", "success");
    } else {
      showToast(data.detail || "IMAP connection failed", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function testNewAccountCredentials() {
  const name = document.getElementById("acc-name").value;
  const provider = document.getElementById("acc-provider").value;
  const email = document.getElementById("acc-email").value;
  const password = document.getElementById("acc-password").value;
  const host = document.getElementById("acc-host").value;
  const port = document.getElementById("acc-port").value || 993;

  if (!email || !password || !host) {
    showToast("Please enter Email Address, Password, and IMAP Host to test connection.", "error");
    return;
  }

  const credentialsObj = { username: email, password, host, port: parseInt(port) };
  showToast("Testing IMAP SSL credentials...", "info");

  try {
    const res = await fetch("/api/accounts/test-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "Test Account",
        provider,
        email_address: email,
        credentials_json: JSON.stringify(credentialsObj)
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "IMAP SSL connection test successful!", "success");
    } else {
      showToast(data.detail || "IMAP connection test failed", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function addAccount() {
  const name = document.getElementById("acc-name").value;
  const provider = document.getElementById("acc-provider").value;
  const email = document.getElementById("acc-email").value;
  const password = document.getElementById("acc-password").value;
  const host = document.getElementById("acc-host").value;
  const port = document.getElementById("acc-port").value || 993;

  if (!name || !email) {
    showToast("Please enter Account Label and Email Address", "error");
    return;
  }

  const credentialsObj = { username: email, password, host, port: parseInt(port) };

  try {
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        provider,
        email_address: email,
        credentials_json: JSON.stringify(credentialsObj)
      })
    });
    if (res.ok) {
      showToast("Email account added successfully!", "success");
      loadAccounts();
      document.getElementById("acc-name").value = "";
      document.getElementById("acc-email").value = "";
      document.getElementById("acc-password").value = "";
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function syncAccount(accId) {
  const syncToast = showToast("⏳ Sync in progress: fetching emails from IMAP mailbox...", "loading", true);
  try {
    const res = await fetch(`/api/accounts/${accId}/sync`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      if (syncToast) {
        syncToast.update(data.message || "Sync finished successfully.", "success");
        setTimeout(() => syncToast.dismiss(), 1200);
      } else {
        showToast(data.message, "success");
      }
      loadCandidates();
    } else {
      if (syncToast) syncToast.dismiss();
      showToast(data.detail || "Sync failed", "error");
    }
  } catch (err) {
    if (syncToast) syncToast.dismiss();
    showToast(`Error: ${err.message}`, "error");
  }
}

async function deleteAccount(accId) {
  if (!confirm("Are you sure you want to remove this account?")) return;
  try {
    const res = await fetch(`/api/accounts/${accId}`, { method: "DELETE" });
    if (res.ok) {
      showToast("Account removed", "info");
      loadAccounts();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function loadAISettings() {
  try {
    const res = await fetch("/api/ai/settings");
    if (!res.ok) return;
    const data = await res.json();

    const providerSelect = document.getElementById("ai-provider");
    const keyInput = document.getElementById("ai-key");
    const modelInput = document.getElementById("ai-model");

    if (providerSelect) providerSelect.value = data.provider;
    if (keyInput && data.api_key_configured) keyInput.placeholder = "••••••••••••••••••••••••••••••••";
    if (modelInput) modelInput.value = data.model_name || "";
  } catch (err) {
    console.error("AI Settings load error", err);
  }
}

async function saveAISettings() {
  const provider = document.getElementById("ai-provider").value;
  const key = document.getElementById("ai-key").value;
  const model = document.getElementById("ai-model").value;

  if (provider !== "mock" && !model.trim()) {
    showToast(`Model Name is required for ${provider.toUpperCase()}! Please enter a model name.`, "error");
    return;
  }

  try {
    const res = await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        api_key: key || null,
        model_name: model.trim()
      })
    });
    if (res.ok) {
      showToast("AI Settings updated!", "success");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function testAIConnection() {
  const provider = document.getElementById("ai-provider").value;
  const key = document.getElementById("ai-key").value;
  const model = document.getElementById("ai-model").value;

  if (provider !== "mock" && !model.trim()) {
    showToast(`Model Name is required to test ${provider.toUpperCase()} connection!`, "error");
    return;
  }

  showToast(`Testing ${provider.toUpperCase()} API connection...`, "info");

  try {
    const res = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        api_key: key || null,
        model_name: model.trim()
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "AI API Connection Successful!", "success");
    } else {
      showToast(data.detail || "AI API Connection Test Failed", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
