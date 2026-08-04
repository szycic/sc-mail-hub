/**
 * Inbox Candidate List Controller & Renderer for SC Mail Hub.
 */

let currentCandidates = [];
let currentStatusFilter = "PENDING";
let currentPage = 1;
let pageSize = 10;
let totalCandidates = 0;
let totalPages = 1;

async function loadCandidates(statusFilter, page) {
  if (statusFilter) {
    currentStatusFilter = statusFilter;
    currentPage = 1;
  }
  if (page !== undefined && page !== null) {
    currentPage = page;
  }

  const listEl = document.getElementById("candidates-list");
  const pagEl = document.getElementById("inbox-pagination");
  if (!listEl) return;

  const accountFilter = document.getElementById("filter-account")?.value || "ALL";
  const recipientTypeFilter = document.getElementById("filter-recipient-type")?.value || "ALL";
  const sortBy = document.getElementById("sort-candidates")?.value || "NEWEST";

  listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div>Loading task candidates...</div>`;

  try {
    const params = new URLSearchParams();
    if (currentStatusFilter && currentStatusFilter !== "ALL") {
      params.append("status", currentStatusFilter);
    }
    if (accountFilter && accountFilter !== "ALL") {
      params.append("account_id", accountFilter);
    }
    if (recipientTypeFilter && recipientTypeFilter !== "ALL") {
      params.append("recipient_type", recipientTypeFilter);
    }
    if (sortBy) {
      params.append("sort_by", sortBy);
    }
    params.append("page", currentPage);
    params.append("page_size", pageSize);

    const url = `/api/inbox/candidates?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch candidates");

    const data = await res.json();
    if (Array.isArray(data)) {
      currentCandidates = data;
      totalCandidates = data.length;
      totalPages = 1;
      currentPage = 1;
    } else {
      currentCandidates = data.items || [];
      totalCandidates = data.total || 0;
      totalPages = data.total_pages || 1;
      currentPage = data.page || 1;
    }

    renderCandidates(currentCandidates);
    renderPagination();
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>Error loading candidates: ${err.message}</div>`;
    if (pagEl) pagEl.innerHTML = "";
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
    const isCreated = c.status === "CREATED";
    const isIgnored = c.status === "IGNORED";
    const isAiProcessed = c.status === "AI_PROCESSED";

    const startDateFmt = (isCreated || isAiProcessed) ? formatStandardDisplayDate(c.start_date) : "";
    const deadlineFmt = (isCreated || isAiProcessed) ? formatStandardDisplayDate(c.deadline) : "";

    return `
      <div class="candidate-card" id="candidate-card-${c.id}">
        <div class="candidate-header">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom: 6px; flex-wrap:wrap;">
              ${c.recipient_type === "DIRECT" ? `<span class="type-pill" style="background:rgba(16,185,129,0.15); color:#6ee7b7; border:1px solid rgba(16,185,129,0.3); font-weight:600; font-size:11px; padding:3px 8px; border-radius:4px;">👤 Direct Email</span>` : ''}
              ${c.recipient_type === "MAILING_GROUP" ? `<span class="type-pill" style="background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3); font-weight:600; font-size:11px; padding:3px 8px; border-radius:4px;">👥 Mailing Group</span>` : ''}
              ${(isCreated || isAiProcessed) && c.priority ? `<span class="importance-badge ${c.priority}">${escapeHtml(c.priority)}</span>` : ''}
              ${startDateFmt ? `<span class="meta-item" style="color:#6ee7b7;">🚀 <strong>Start: ${escapeHtml(startDateFmt)}</strong></span>` : ''}
              ${deadlineFmt ? `<span class="meta-item" style="color:#fde047;">📅 <strong>Due: ${escapeHtml(deadlineFmt)}</strong></span>` : ''}
            </div>
            <h3 class="candidate-title">${escapeHtml(c.title)}</h3>
          </div>
          <div>
            ${isCreated ? `<span class="btn btn-sm btn-outline" style="color:#10b981; border-color:#10b981;">✓ Synced to Notion</span>` : ''}
            ${isAiProcessed ? `<span class="btn btn-sm btn-outline" style="color:#60a5fa; border-color:#60a5fa;">✨ Ready for Notion</span>` : ''}
            ${isIgnored ? `<span class="btn btn-sm btn-outline" style="color:#64748b;">Ignored</span>` : ''}
          </div>
        </div>

        ${(isCreated || isAiProcessed) && c.summary ? `<p class="candidate-summary">${escapeHtml(c.summary)}</p>` : ''}

        <div class="candidate-meta">
          ${c.sender ? `<div>📧 From: <strong>${escapeHtml(c.sender)}</strong></div>` : ''}
          ${c.recipient ? `<div>📥 To: <strong>${escapeHtml(c.recipient)}</strong></div>` : ''}
          ${c.subject ? `<div>✉️ Subject: <i>"${escapeHtml(c.subject)}"</i></div>` : ''}
          ${c.received_at ? `<div>📩 Received: <strong>${escapeHtml(c.received_at)}</strong></div>` : ''}
        </div>

        <div class="candidate-actions">
          ${!isCreated && !isIgnored && !isAiProcessed ? `
            <button class="btn btn-primary btn-sm" onclick="openTaskReviewModal(${c.id})">
              ✨ Run AI & Review
            </button>
            <button class="btn btn-outline btn-sm" onclick="ignoreCandidate(${c.id})">
              🚫 Ignore
            </button>
          ` : ''}

          ${isAiProcessed ? `
            <button class="btn btn-primary btn-sm" onclick="openTaskReviewModal(${c.id})">
              ✏️ Edit & Add to Notion
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
        </div>
      </div>
    `;
  }).join("");
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
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Task candidate restored", "info");
      loadCandidates(currentStatusFilter);
    } else {
      showToast(data.detail || "Failed to restore candidate", "error");
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

async function triggerSampleIngest() {
  const loadingToast = showToast("Stage 1/3: Connecting to IMAP mailboxes...", "loading", true);

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
          loadingToast.update("Stage 3/3: Ready for review and Notion sync...", "success");
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
  loadCandidates(status, 1);
}

function changePage(newPage) {
  if (newPage < 1 || newPage > totalPages || newPage === currentPage) return;
  loadCandidates(null, newPage);
}

function changePageSize(newSize) {
  pageSize = parseInt(newSize, 10) || 10;
  currentPage = 1;
  loadCandidates();
}

function renderPagination() {
  const pagEl = document.getElementById("inbox-pagination");
  if (!pagEl) return;

  if (totalCandidates === 0) {
    pagEl.innerHTML = "";
    pagEl.style.display = "none";
    return;
  }

  pagEl.style.display = "flex";

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalCandidates);

  let pageButtonsHtml = "";

  const createBtn = (p, label = p, isActive = false, isDisabled = false) => `
    <button class="pagination-btn ${isActive ? 'active' : ''}" 
      ${isDisabled ? 'disabled' : ''} 
      onclick="changePage(${p})">${label}</button>
  `;

  pageButtonsHtml += createBtn(currentPage - 1, '‹', false, currentPage <= 1);

  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  if (startPage > 1) {
    pageButtonsHtml += createBtn(1, 1, currentPage === 1);
    if (startPage > 2) {
      pageButtonsHtml += `<span class="pagination-ellipsis">…</span>`;
    }
  }

  for (let p = startPage; p <= endPage; p++) {
    pageButtonsHtml += createBtn(p, p, p === currentPage);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pageButtonsHtml += `<span class="pagination-ellipsis">…</span>`;
    }
    pageButtonsHtml += createBtn(totalPages, totalPages, currentPage === totalPages);
  }

  pageButtonsHtml += createBtn(currentPage + 1, '›', false, currentPage >= totalPages);

  pagEl.innerHTML = `
    <div class="pagination-info">
      Showing <strong>${startItem}-${endItem}</strong> of <strong>${totalCandidates}</strong> candidate${totalCandidates !== 1 ? 's' : ''}
      <span style="margin-left:8px; display:inline-flex; align-items:center; gap:6px;">
        | Show: 
        <select class="select-input" style="padding:2px 6px; font-size:12px; width:auto;" onchange="changePageSize(this.value)">
          <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
          <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
        </select>
      </span>
    </div>
    <div class="pagination-controls">
      ${pageButtonsHtml}
    </div>
  `;
}

