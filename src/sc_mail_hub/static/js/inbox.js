/**
 * Inbox Candidate List Controller & Renderer for SC Mail Hub.
 */

let currentCandidates = [];
let currentStatusFilter = "PENDING";
let currentPage = 1;
let pageSize = 10;
let totalCandidates = 0;
let totalPages = 1;

let lastSyncedIso = null;
let searchDebounceTimer = null;
let selectedCandidateIds = new Set();

function initInboxStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const statusParam = params.get("status");
  const pageParam = params.get("page");
  const pageSizeParam = params.get("page_size");
  const searchParam = params.get("search");

  if (statusParam) {
    const validStatuses = ["PENDING", "AI_PROCESSED", "CREATED", "IGNORED", "ALL"];
    if (validStatuses.includes(statusParam.toUpperCase())) {
      currentStatusFilter = statusParam.toUpperCase();
      document.querySelectorAll(".inbox-filter-btn").forEach(b => b.classList.remove("active"));
      const btn = document.getElementById(`filter-btn-${currentStatusFilter}`);
      if (btn) btn.classList.add("active");
    }
  }

  if (pageParam) {
    const p = parseInt(pageParam, 10);
    if (!isNaN(p) && p >= 1) {
      currentPage = p;
    }
  }

  if (pageSizeParam) {
    const ps = parseInt(pageSizeParam, 10);
    if (!isNaN(ps) && ps >= 1) {
      pageSize = ps;
    }
  }

  if (searchParam) {
    const searchInput = document.getElementById("filter-search");
    if (searchInput) {
      searchInput.value = searchParam;
    }
  }
}

function updateUrlParams() {
  const url = new URL(window.location);

  if (currentStatusFilter && currentStatusFilter !== "PENDING") {
    url.searchParams.set("status", currentStatusFilter);
  } else {
    url.searchParams.delete("status");
  }

  if (currentPage && currentPage > 1) {
    url.searchParams.set("page", currentPage);
  } else {
    url.searchParams.delete("page");
  }

  if (pageSize && pageSize !== 10) {
    url.searchParams.set("page_size", pageSize);
  } else {
    url.searchParams.delete("page_size");
  }

  const searchVal = document.getElementById("filter-search")?.value?.trim();
  if (searchVal) {
    url.searchParams.set("search", searchVal);
  } else {
    url.searchParams.delete("search");
  }

  const newUrl = url.pathname + url.search + url.hash;
  if (window.location.pathname + window.location.search + window.location.hash !== newUrl) {
    history.replaceState(null, "", newUrl);
  }
}

function toggleCandidateSelection(candidateId, isChecked) {
  if (isChecked) {
    selectedCandidateIds.add(candidateId);
  } else {
    selectedCandidateIds.delete(candidateId);
  }
  updateBulkActionUI();
}

function toggleSelectAllCandidates(isChecked) {
  const visibleCbs = document.querySelectorAll(".candidate-select-cb");
  visibleCbs.forEach(cb => {
    cb.checked = isChecked;
    const id = parseInt(cb.getAttribute("data-id"), 10);
    if (id) {
      if (isChecked) selectedCandidateIds.add(id);
      else selectedCandidateIds.delete(id);
    }
  });
  updateBulkActionUI();
}

function updateBulkActionUI() {
  const bulkBar = document.getElementById("bulk-action-bar");
  if (currentStatusFilter === "ALL") {
    if (bulkBar) bulkBar.style.display = "none";
    return;
  }
  if (bulkBar) bulkBar.style.display = "flex";

  const count = selectedCandidateIds.size;
  const countEl = document.getElementById("bulk-selected-count");
  if (countEl) {
    countEl.textContent = `(${count} selected)`;
  }

  const btnProcess = document.getElementById("btn-bulk-process");
  const btnReprocess = document.getElementById("btn-bulk-reprocess");
  const btnNotion = document.getElementById("btn-bulk-notion");
  const btnIgnore = document.getElementById("btn-bulk-ignore");
  const btnUnignore = document.getElementById("btn-bulk-unignore");

  if (btnProcess) {
    const showProcess = currentStatusFilter === "PENDING";
    btnProcess.style.display = showProcess ? "inline-flex" : "none";
    btnProcess.disabled = count === 0;
  }

  if (btnReprocess) {
    const showReprocess = currentStatusFilter === "AI_PROCESSED";
    btnReprocess.style.display = showReprocess ? "inline-flex" : "none";
    btnReprocess.disabled = count === 0;
  }

  if (btnNotion) {
    const showNotion = currentStatusFilter === "CREATED";
    btnNotion.style.display = showNotion ? "inline-flex" : "none";
    btnNotion.disabled = count === 0;
  }

  if (btnIgnore) {
    const showIgnore = currentStatusFilter === "PENDING" || currentStatusFilter === "AI_PROCESSED";
    btnIgnore.style.display = showIgnore ? "inline-flex" : "none";
    btnIgnore.disabled = count === 0;
  }

  if (btnUnignore) {
    const showUnignore = currentStatusFilter === "IGNORED";
    btnUnignore.style.display = showUnignore ? "inline-flex" : "none";
    btnUnignore.disabled = count === 0;
  }

  const selectAllCb = document.getElementById("select-all-cb");
  const visibleCbs = document.querySelectorAll(".candidate-select-cb");
  if (selectAllCb && visibleCbs.length > 0) {
    selectAllCb.checked = Array.from(visibleCbs).every(cb => cb.checked);
  } else if (selectAllCb) {
    selectAllCb.checked = false;
  }
}

let syncUpdatesWs = null;
let syncUpdatesReconnectTimer = null;

function applyInboxStatsData(counts, lastSyncedAt) {
  if (counts) {
    ["PENDING", "AI_PROCESSED", "CREATED", "IGNORED", "ALL"].forEach(st => {
      const badgeEl = document.getElementById(`badge-${st}`);
      if (badgeEl) {
        badgeEl.textContent = counts[st] !== undefined ? counts[st] : 0;
      }
    });
  }

  if (lastSyncedAt) {
    lastSyncedIso = lastSyncedAt;
    updateLastSyncedDisplay();
  }
}

async function loadInboxStats() {
  try {
    const res = await fetch("/api/inbox/stats");
    if (!res.ok) return;
    const data = await res.json();
    applyInboxStatsData(data.counts, data.last_synced_at);
  } catch (err) {
    console.error("Failed to load inbox stats:", err);
  }
}

function initSyncUpdatesWebSocket() {
  if (syncUpdatesWs) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/inbox/ws/sync-updates`;

  try {
    syncUpdatesWs = new WebSocket(wsUrl);

    syncUpdatesWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "initial_stats" || data.event === "sync_completed") {
          applyInboxStatsData(data.stats, data.last_synced_at);
          if (data.event === "sync_completed" && typeof loadCandidates === "function") {
            loadCandidates();
          }
        }
      } catch (e) {
        console.error("Error parsing sync WebSocket message:", e);
      }
    };

    syncUpdatesWs.onclose = () => {
      syncUpdatesWs = null;
      if (!syncUpdatesReconnectTimer) {
        syncUpdatesReconnectTimer = setTimeout(() => {
          syncUpdatesReconnectTimer = null;
          initSyncUpdatesWebSocket();
        }, 5000);
      }
    };

    syncUpdatesWs.onerror = () => {
      if (syncUpdatesWs) syncUpdatesWs.close();
    };
  } catch (e) {
    console.error("Failed to initialize sync WebSocket:", e);
  }
}

function updateLastSyncedDisplay() {
  const el = document.getElementById("last-synced-indicator");
  if (!el) return;
  if (!lastSyncedIso) {
    el.textContent = "Last synced: Never";
    return;
  }
  const syncDate = new Date(lastSyncedIso);
  const now = new Date();
  const diffSec = Math.floor((now - syncDate) / 1000);

  let label = "Just now";
  if (diffSec >= 60 && diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    label = `${mins} min${mins > 1 ? 's' : ''} ago`;
  } else if (diffSec >= 3600 && diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    label = `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  } else if (diffSec >= 86400) {
    const days = Math.floor(diffSec / 86400);
    label = `${days} day${days > 1 ? 's' : ''} ago`;
  }
  el.textContent = `Last synced: ${label}`;
}

document.addEventListener("DOMContentLoaded", () => {
  initSyncUpdatesWebSocket();
});

setInterval(updateLastSyncedDisplay, 10000);
setInterval(loadInboxStats, 60000);

function handleSearchInput() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentPage = 1;
    loadCandidates();
  }, 300);
}

async function loadCandidates(statusFilter, page) {
  if (statusFilter && statusFilter !== currentStatusFilter) {
    currentStatusFilter = statusFilter;
    currentPage = 1;
  } else if (statusFilter) {
    currentStatusFilter = statusFilter;
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
  const searchVal = document.getElementById("filter-search")?.value?.trim() || "";

  const savedScrollY = window.scrollY;
  const isInitialLoad = !listEl.children.length || listEl.querySelector(".empty-state");

  if (isInitialLoad) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div>Loading task candidates...</div>`;
  } else {
    listEl.style.opacity = "0.65";
    listEl.style.pointerEvents = "none";
  }

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
    if (searchVal) {
      params.append("search", searchVal);
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
      if (data.total_pages > 0 && currentPage > data.total_pages) {
        return loadCandidates(null, data.total_pages);
      }
    }

    renderCandidates(currentCandidates);
    renderPagination();
    loadInboxStats();
    updateUrlParams();

    if (!isInitialLoad) {
      window.scrollTo({ top: savedScrollY });
    }
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>Error loading candidates: ${err.message}</div>`;
    if (pagEl) pagEl.innerHTML = "";
  } finally {
    listEl.style.opacity = "1";
    listEl.style.pointerEvents = "auto";
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
    updateBulkActionUI();
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
          <div style="display:flex; align-items:flex-start; gap:10px;">
            ${currentStatusFilter !== "ALL" ? `
              <input type="checkbox" class="candidate-select-cb" data-id="${c.id}" style="margin-top:4px; cursor:pointer; width:15px; height:15px; accent-color:var(--accent-gradient);"
                ${selectedCandidateIds.has(c.id) ? 'checked' : ''} onchange="toggleCandidateSelection(${c.id}, this.checked)">
            ` : ''}
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
            <button class="btn btn-primary btn-sm" onclick="processCandidateWithAi(${c.id})">
              🤖 Process
            </button>
            <button class="btn btn-outline btn-sm" style="color:#a5b4fc; border-color:rgba(99,102,241,0.4);" onclick="openTaskReviewModal(${c.id})">
              ✨ Process & Review
            </button>
            <button class="btn btn-outline btn-sm" onclick="ignoreCandidate(${c.id})">
              🚫 Ignore
            </button>
          ` : ''}

          ${isAiProcessed ? `
            <button class="btn btn-primary btn-sm" onclick="openTaskReviewModal(${c.id})">
              ✏️ Review
            </button>
            <button class="btn btn-outline btn-sm" onclick="reprocessCandidateWithAi(${c.id})">
              🔄 Reprocess
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
              🔗 Open in Notion
            </a>
          ` : ''}

          <button class="btn btn-outline btn-sm" onclick="previewEmail(${c.id})">
            👁️ Preview Email
          </button>
        </div>
      </div>
    `;
  }).join("");

  updateBulkActionUI();
}

function handleAiProviderError(detail, onFallbackConfirm) {
  const choice = confirm(
    `AI Provider Error:\n${detail}\n\n` +
    `• Click OK to fall back to heuristic extraction.\n` +
    `• Click Cancel to abort operation.`
  );

  if (choice) {
    onFallbackConfirm();
  }
}

async function bulkProcessCandidates(allowFallback = false) {
  if (selectedCandidateIds.size === 0) return;
  const ids = Array.from(selectedCandidateIds);
  const loadingToast = showToast(`Processing ${ids.length} candidate(s) with AI...`, "loading", true);

  try {
    const url = `/api/inbox/candidates/batch-process${allowFallback ? '?allow_fallback=true' : ''}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_ids: ids })
    });
    const data = await res.json();
    if (loadingToast) loadingToast.dismiss();

    if (res.ok) {
      showToast(data.message || `Processed ${ids.length} candidate(s)`, "success");
      selectedCandidateIds.clear();
      updateBulkActionUI();
      loadCandidates();
    } else {
      if (!allowFallback && data.detail && (data.detail.includes("AI Provider") || data.detail.includes("OpenAI") || data.detail.includes("Gemini") || data.detail.includes("Groq"))) {
        handleAiProviderError(data.detail, () => bulkProcessCandidates(true));
      } else {
        showToast(data.detail || "Failed batch processing", "error");
      }
    }
  } catch (err) {
    if (loadingToast) loadingToast.dismiss();
    showToast(`Error: ${err.message}`, "error");
  }
}

async function bulkReprocessCandidates(allowFallback = false) {
  if (selectedCandidateIds.size === 0) return;
  const ids = Array.from(selectedCandidateIds);
  const loadingToast = showToast(`Re-running AI extraction for ${ids.length} candidate(s)...`, "loading", true);

  try {
    const url = `/api/inbox/candidates/batch-reprocess${allowFallback ? '?allow_fallback=true' : ''}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_ids: ids })
    });
    const data = await res.json();
    if (loadingToast) loadingToast.dismiss();

    if (res.ok) {
      showToast(data.message || `Reprocessed ${ids.length} candidate(s)`, "info");
      selectedCandidateIds.clear();
      updateBulkActionUI();
      loadCandidates();
    } else {
      if (!allowFallback && data.detail && (data.detail.includes("AI Provider") || data.detail.includes("OpenAI") || data.detail.includes("Gemini") || data.detail.includes("Groq"))) {
        handleAiProviderError(data.detail, () => bulkReprocessCandidates(true));
      } else {
        showToast(data.detail || "Failed batch reprocess", "error");
      }
    }
  } catch (err) {
    if (loadingToast) loadingToast.dismiss();
    showToast(`Error: ${err.message}`, "error");
  }
}

async function bulkIgnoreCandidates() {
  if (selectedCandidateIds.size === 0) return;
  const ids = Array.from(selectedCandidateIds);
  try {
    const res = await fetch("/api/inbox/candidates/batch-ignore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_ids: ids })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || `Ignored ${ids.length} candidate(s)`, "info");
      selectedCandidateIds.clear();
      updateBulkActionUI();
      loadCandidates();
    } else {
      showToast(data.detail || "Failed batch ignore", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function bulkUnignoreCandidates() {
  if (selectedCandidateIds.size === 0) return;
  const ids = Array.from(selectedCandidateIds);
  try {
    const res = await fetch("/api/inbox/candidates/batch-unignore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_ids: ids })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || `Restored ${ids.length} candidate(s)`, "info");
      selectedCandidateIds.clear();
      updateBulkActionUI();
      loadCandidates();
    } else {
      showToast(data.detail || "Failed batch unignore", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function bulkOpenNotionTasks() {
  if (selectedCandidateIds.size === 0) return;
  let openedCount = 0;

  currentCandidates.forEach(c => {
    if (selectedCandidateIds.has(c.id) && c.notion_url) {
      window.open(c.notion_url, "_blank");
      openedCount++;
    }
  });

  if (openedCount > 0) {
    showToast(`Opened ${openedCount} Notion task(s)`, "info");
  } else {
    showToast("No Notion links available for selected candidates", "warning");
  }
}

async function ignoreCandidate(candidateId) {
  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/ignore`, {
      method: "POST"
    });
    if (res.ok) {
      showToast("Task candidate ignored", "info");
      loadCandidates();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function processCandidateWithAi(candidateId, allowFallback = false) {
  const card = document.getElementById(`candidate-card-${candidateId}`);
  if (card) card.style.opacity = "0.6";

  const loadingToast = showToast("Running AI extraction for task details...", "loading", true);

  try {
    const url = `/api/inbox/candidates/${candidateId}/prepare-task${allowFallback ? '?allow_fallback=true' : ''}`;
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();

    if (loadingToast) loadingToast.dismiss();

    if (res.ok) {
      showToast("Candidate processed with AI!", "success");
      loadCandidates();
    } else {
      if (card) card.style.opacity = "1";
      if (!allowFallback && data.detail && (data.detail.includes("AI Provider") || data.detail.includes("OpenAI") || data.detail.includes("Gemini") || data.detail.includes("Groq"))) {
        handleAiProviderError(data.detail, () => processCandidateWithAi(candidateId, true));
      } else {
        showToast(data.detail || "Failed to process candidate", "error");
      }
    }
  } catch (err) {
    if (loadingToast) loadingToast.dismiss();
    if (card) card.style.opacity = "1";
    showToast(`Error: ${err.message}`, "error");
  }
}

async function reprocessCandidateWithAi(candidateId, allowFallback = false) {
  const card = document.getElementById(`candidate-card-${candidateId}`);
  if (card) card.style.opacity = "0.6";

  const loadingToast = showToast("Re-running AI extraction for task details...", "loading", true);

  try {
    const url = `/api/inbox/candidates/${candidateId}/prepare-task?force=true${allowFallback ? '&allow_fallback=true' : ''}`;
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();

    if (loadingToast) loadingToast.dismiss();

    if (res.ok) {
      showToast("Candidate reprocessed with AI!", "success");
      loadCandidates();
    } else {
      if (card) card.style.opacity = "1";
      if (!allowFallback && data.detail && (data.detail.includes("AI Provider") || data.detail.includes("OpenAI") || data.detail.includes("Gemini") || data.detail.includes("Groq"))) {
        handleAiProviderError(data.detail, () => reprocessCandidateWithAi(candidateId, true));
      } else {
        showToast(data.detail || "Failed to reprocess candidate", "error");
      }
    }
  } catch (err) {
    if (loadingToast) loadingToast.dismiss();
    if (card) card.style.opacity = "1";
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
      loadCandidates();
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
      loadCandidates();
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
  selectedCandidateIds.clear();
  currentStatusFilter = status;
  updateBulkActionUI();
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

