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
let focusedCandidateIndex = -1;

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

function applyInboxStatsData(counts, lastSyncedAt, isSyncing = false) {
  if (counts) {
    ["PENDING", "AI_PROCESSED", "CREATED", "IGNORED", "ALL"].forEach(st => {
      const badgeEl = document.getElementById(`badge-${st}`);
      if (badgeEl) {
        const val = counts[st] !== undefined ? counts[st] : 0;
        badgeEl.textContent = val > 999 ? "999+" : val;
        if (val > 999) {
          badgeEl.title = `${val} items`;
        } else {
          badgeEl.removeAttribute("title");
        }
      }
    });

    const pendingCount = counts["PENDING"] !== undefined ? counts["PENDING"] : 0;
    if (pendingCount > 0) {
      const displayPending = pendingCount > 99 ? "99+" : pendingCount;
      document.title = `(${displayPending}) Mail Hub`;
    } else {
      document.title = "Mail Hub";
    }

    if (typeof handlePendingNotifications === "function") {
      handlePendingNotifications(pendingCount, isSyncing);
    }
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
    applyInboxStatsData(data.counts, data.last_synced_at, !!data.is_syncing);
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
        if (data.event === "initial_stats" || data.event === "sync_completed" || data.event === "sync_progress") {
          applyInboxStatsData(data.stats, data.last_synced_at, !!data.is_syncing);
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
    el.removeAttribute("title");
    return;
  }
  const syncDate = parseUtcDate(lastSyncedIso);
  if (!syncDate) {
    el.textContent = "Last synced: Never";
    el.removeAttribute("title");
    return;
  }
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
  el.title = `Last synced at ${formatDateTime(lastSyncedIso)}`;
}

function clearCandidateFocus() {
  focusedCandidateIndex = -1;
  const cards = document.querySelectorAll("#candidates-list .candidate-card");
  cards.forEach(card => {
    card.classList.remove("focused");
    if (document.activeElement === card) {
      card.blur();
    }
  });
}

function setFocusedCandidateIndex(index, scroll = true) {
  const cards = Array.from(document.querySelectorAll("#candidates-list .candidate-card"));
  if (!cards || cards.length === 0 || index < 0) {
    clearCandidateFocus();
    return;
  }

  if (index >= cards.length) index = cards.length - 1;

  focusedCandidateIndex = index;

  cards.forEach((card, i) => {
    if (i === focusedCandidateIndex) {
      card.classList.add("focused");
      if (document.activeElement !== card && !card.contains(document.activeElement)) {
        card.focus({ preventScroll: true });
      }
      if (scroll) {
        card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else {
      card.classList.remove("focused");
    }
  });
}

function openShortcutsModal() {
  const modal = document.getElementById("shortcuts-modal");
  if (modal) modal.classList.add("active");
}

function closeShortcutsModal(e) {
  if (!e || e.target === document.getElementById("shortcuts-modal") || e.target.closest(".modal-close-btn") || e.target.closest(".btn")) {
    const modal = document.getElementById("shortcuts-modal");
    if (modal) modal.classList.remove("active");
  }
}

function handleCandidateKeyboardShortcuts(e) {
  if (e.key === "Escape") {
    if (typeof isTaskReviewSubmitting !== "undefined" && isTaskReviewSubmitting) {
      e.preventDefault();
      return;
    }
    const activeModals = document.querySelectorAll(".modal-overlay.active, .modal.active, .modal-backdrop.active");
    if (activeModals.length > 0) {
      e.preventDefault();
      const taskReviewModal = document.getElementById("task-review-modal");
      if (taskReviewModal && taskReviewModal.classList.contains("active")) {
        closeTaskReviewModal();
      } else {
        activeModals.forEach(m => m.classList.remove("active"));
      }
      return;
    }
    clearCandidateFocus();
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    return;
  }

  const activeEl = document.activeElement;
  if (activeEl && (
    activeEl.tagName === "INPUT" ||
    activeEl.tagName === "TEXTAREA" ||
    activeEl.tagName === "SELECT" ||
    activeEl.isContentEditable
  )) {
    return;
  }

  const shortcutsModal = document.getElementById("shortcuts-modal");
  const isShortcutsModalActive = shortcutsModal && shortcutsModal.classList.contains("active");

  if (e.key === "?") {
    e.preventDefault();
    if (isShortcutsModalActive) {
      closeShortcutsModal();
    } else {
      openShortcutsModal();
    }
    return;
  }

  if (e.key === "/") {
    e.preventDefault();
    const searchInput = document.getElementById("filter-search");
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  if (e.key === "1") { e.preventDefault(); filterInbox("PENDING"); return; }
  if (e.key === "2") { e.preventDefault(); filterInbox("AI_PROCESSED"); return; }
  if (e.key === "3") { e.preventDefault(); filterInbox("CREATED"); return; }
  if (e.key === "4") { e.preventDefault(); filterInbox("IGNORED"); return; }
  if (e.key === "5") { e.preventDefault(); filterInbox("ALL"); return; }

  const modalActive = document.querySelector(".modal.active, .modal-backdrop.active, .modal-overlay.active") ||
    (document.getElementById("task-review-modal")?.style.display === "flex") ||
    (document.getElementById("email-preview-modal")?.style.display === "flex");
  if (modalActive) return;

  const inboxTab = document.getElementById("tab-inbox");
  if (!inboxTab || !inboxTab.classList.contains("active")) return;

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    if (currentPage > 1) changePage(currentPage - 1);
    return;
  }

  if (e.key === "ArrowRight") {
    e.preventDefault();
    if (currentPage < totalPages) changePage(currentPage + 1);
    return;
  }

  const cards = Array.from(document.querySelectorAll("#candidates-list .candidate-card"));
  if (!cards || cards.length === 0) return;

  // --- Bulk Action Shortcuts (Shift + Key) ---
  if (e.shiftKey) {
    if (e.key === "P" || e.key === "p") {
      e.preventDefault();
      if (typeof bulkProcessCandidates === "function") bulkProcessCandidates();
      return;
    }
    if (e.key === "I" || e.key === "i") {
      e.preventDefault();
      if (typeof bulkIgnoreCandidates === "function") bulkIgnoreCandidates();
      return;
    }
    if (e.key === "R" || e.key === "r") {
      e.preventDefault();
      if (typeof bulkReprocessCandidates === "function") bulkReprocessCandidates();
      return;
    }
    if (e.key === "U" || e.key === "u") {
      e.preventDefault();
      if (typeof bulkUnignoreCandidates === "function") bulkUnignoreCandidates();
      return;
    }
  }

  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      let nextIdx = focusedCandidateIndex - 1;
      if (nextIdx < 0) nextIdx = cards.length - 1;
      setFocusedCandidateIndex(nextIdx);
    } else {
      let nextIdx = focusedCandidateIndex + 1;
      if (nextIdx >= cards.length) nextIdx = 0;
      setFocusedCandidateIndex(nextIdx);
    }
    return;
  }

  if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
    e.preventDefault();
    let currentIdx = focusedCandidateIndex;
    if (currentIdx < 0) currentIdx = 0;

    let nextIdx = currentIdx - 1;
    if (nextIdx < 0) nextIdx = 0;

    if (e.shiftKey) {
      if (cards[currentIdx]) {
        const cb = cards[currentIdx].querySelector(".candidate-select-cb");
        if (cb) {
          cb.checked = true;
          const id = parseInt(cb.getAttribute("data-id"), 10);
          if (id) toggleCandidateSelection(id, true);
        }
      }
      setFocusedCandidateIndex(nextIdx);
      if (cards[nextIdx]) {
        const cb = cards[nextIdx].querySelector(".candidate-select-cb");
        if (cb) {
          cb.checked = true;
          const id = parseInt(cb.getAttribute("data-id"), 10);
          if (id) toggleCandidateSelection(id, true);
        }
      }
    } else {
      setFocusedCandidateIndex(nextIdx);
    }
    return;
  }

  if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
    e.preventDefault();
    let currentIdx = focusedCandidateIndex;
    if (currentIdx < 0) currentIdx = 0;

    let nextIdx = currentIdx + 1;
    if (nextIdx >= cards.length) nextIdx = cards.length - 1;

    if (e.shiftKey) {
      if (cards[currentIdx]) {
        const cb = cards[currentIdx].querySelector(".candidate-select-cb");
        if (cb) {
          cb.checked = true;
          const id = parseInt(cb.getAttribute("data-id"), 10);
          if (id) toggleCandidateSelection(id, true);
        }
      }
      setFocusedCandidateIndex(nextIdx);
      if (cards[nextIdx]) {
        const cb = cards[nextIdx].querySelector(".candidate-select-cb");
        if (cb) {
          cb.checked = true;
          const id = parseInt(cb.getAttribute("data-id"), 10);
          if (id) toggleCandidateSelection(id, true);
        }
      }
    } else {
      setFocusedCandidateIndex(nextIdx);
    }
    return;
  }

  if (e.key === " " || e.key === "Spacebar" || e.key === "x" || e.key === "X") {
    if (activeEl && (activeEl.tagName === "BUTTON" || activeEl.tagName === "A")) {
      return;
    }
    e.preventDefault();
    let idx = focusedCandidateIndex;
    if (idx < 0 || idx >= cards.length) idx = 0;

    if (cards[idx]) {
      setFocusedCandidateIndex(idx, false);
      const cb = cards[idx].querySelector(".candidate-select-cb");
      if (cb) {
        cb.checked = !cb.checked;
        const id = parseInt(cb.getAttribute("data-id"), 10);
        if (id) toggleCandidateSelection(id, cb.checked);
      }
    }
    return;
  }

  if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    const selectAllCb = document.getElementById("select-all-cb");
    if (selectAllCb) {
      selectAllCb.checked = !selectAllCb.checked;
      toggleSelectAllCandidates(selectAllCb.checked);
    }
    return;
  }

  function getActiveCandidate() {
    let idx = focusedCandidateIndex;
    if (idx < 0 || idx >= cards.length) idx = 0;
    if (cards[idx]) {
      const cardId = parseInt(cards[idx].getAttribute("data-id"), 10);
      return currentCandidates.find(c => c.id === cardId);
    }
    return null;
  }

  if (!e.shiftKey && (e.key === "i" || e.key === "I" || e.key === "Delete")) {
    e.preventDefault();
    const cand = getActiveCandidate();
    if (cand) {
      if (cand.status === "IGNORED") {
        if (typeof unignoreCandidate === "function") unignoreCandidate(cand.id);
      } else {
        if (typeof ignoreCandidate === "function") ignoreCandidate(cand.id);
      }
    }
    return;
  }

  if (!e.shiftKey && (e.key === "u" || e.key === "U")) {
    e.preventDefault();
    const cand = getActiveCandidate();
    if (cand && typeof unignoreCandidate === "function") {
      unignoreCandidate(cand.id);
    }
    return;
  }

  if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    const cand = getActiveCandidate();
    if (cand && typeof processCandidateWithAi === "function") {
      processCandidateWithAi(cand.id);
    }
    return;
  }

  if (e.key === "o" || e.key === "O") {
    e.preventDefault();
    const cand = getActiveCandidate();
    if (cand && typeof openTaskReviewModal === "function") {
      openTaskReviewModal(cand.id);
    }
    return;
  }

  if (e.key === "e" || e.key === "E") {
    e.preventDefault();
    const cand = getActiveCandidate();
    if (cand && typeof previewEmail === "function") {
      previewEmail(cand.id);
    }
    return;
  }

  if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    const cand = getActiveCandidate();
    if (cand && typeof reprocessCandidateWithAi === "function") {
      reprocessCandidateWithAi(cand.id);
    }
    return;
  }

  if (e.key === "Enter" || e.key === "o" || e.key === "O") {
    if (activeEl && (activeEl.tagName === "BUTTON" || activeEl.tagName === "A")) {
      return;
    }
    e.preventDefault();
    const cand = getActiveCandidate();
    if (cand) {
      if (cand.status === "PENDING" || cand.status === "AI_PROCESSED") {
        if (typeof openTaskReviewModal === "function") {
          openTaskReviewModal(cand.id);
        }
      } else if (cand.status === "IGNORED") {
        if (typeof unignoreCandidate === "function") {
          unignoreCandidate(cand.id);
        }
      } else {
        if (typeof previewEmail === "function") {
          previewEmail(cand.id);
        }
      }
    }
    return;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initSyncUpdatesWebSocket();
  document.addEventListener("keydown", handleCandidateKeyboardShortcuts);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".candidate-card")) {
      clearCandidateFocus();
    }
  });
});

setInterval(updateLastSyncedDisplay, 10000);
setInterval(() => {
  if (syncUpdatesWs && syncUpdatesWs.readyState === WebSocket.OPEN) {
    return; // Real-time WebSocket handles stats updates
  }
  loadInboxStats();
}, 60000);

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
    focusedCandidateIndex = -1;
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

  if (focusedCandidateIndex >= candidates.length) {
    focusedCandidateIndex = candidates.length - 1;
  }

  listEl.innerHTML = candidates.map((c, index) => {
    const isCreated = c.status === "CREATED";
    const isIgnored = c.status === "IGNORED";
    const isAiProcessed = c.status === "AI_PROCESSED";

    const startDateFmt = (isCreated || isAiProcessed) ? formatStandardDisplayDate(c.start_date) : "";
    const deadlineFmt = (isCreated || isAiProcessed) ? formatStandardDisplayDate(c.deadline) : "";

    return `
      <div class="candidate-card ${index === focusedCandidateIndex ? 'focused' : ''}" id="candidate-card-${c.id}" tabindex="0" data-id="${c.id}" data-index="${index}">
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
            ${isIgnored ? (c.auto_ignored_reason ? `<span class="btn btn-sm btn-outline" style="color:#ef4444; border-color:rgba(239,68,68,0.5); background:rgba(239,68,68,0.1);" title="${escapeHtml(c.auto_ignored_reason)}">🛡️ Auto-Ignored</span>` : `<span class="btn btn-sm btn-outline" style="color:#64748b;">Ignored</span>`) : ''}
          </div>
        </div>



        ${(isCreated || isAiProcessed) && c.summary ? `<p class="candidate-summary">${escapeHtml(c.summary)}</p>` : ''}

        <div class="candidate-meta">
          ${c.sender ? `<div>📧 From: <strong>${escapeHtml(c.sender)}</strong></div>` : ''}
          ${c.recipient ? `<div>📥 To: <strong>${escapeHtml(c.recipient)}</strong></div>` : ''}
          ${c.subject ? `<div>✉️ Subject: <i>"${escapeHtml(c.subject)}"</i></div>` : ''}
          ${c.received_at ? `<div>📩 Received: <strong>${escapeHtml(formatDateTime(c.received_at))}</strong></div>` : ''}
          ${(c.updated_at || c.created_at) ? `<div>🔄 Updated: <strong>${escapeHtml(formatDateTime(c.updated_at || c.created_at))}</strong></div>` : ''}
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

  listEl.onclick = function (e) {
    const card = e.target.closest(".candidate-card");
    if (card) {
      const idx = parseInt(card.getAttribute("data-index"), 10);
      if (!isNaN(idx)) {
        if (!e.target.closest("button, input, a, select")) {
          setFocusedCandidateIndex(idx, false);
        }
      }
    }
  };

  listEl.onfocusin = function (e) {
    const card = e.target.closest(".candidate-card");
    if (card && e.target === card) {
      const idx = parseInt(card.getAttribute("data-index"), 10);
      if (!isNaN(idx) && idx !== focusedCandidateIndex) {
        setFocusedCandidateIndex(idx, false);
      }
    }
  };

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

  ids.forEach(id => {
    const card = document.getElementById(`candidate-card-${id}`);
    if (card) {
      card.style.transition = "opacity 0.2s ease";
      card.style.opacity = "0.3";
      card.style.pointerEvents = "none";
    }
  });

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
      ids.forEach(id => {
        const card = document.getElementById(`candidate-card-${id}`);
        if (card) { card.style.opacity = "1"; card.style.pointerEvents = "auto"; }
      });
      showToast(data.detail || "Failed batch ignore", "error");
    }
  } catch (err) {
    ids.forEach(id => {
      const card = document.getElementById(`candidate-card-${id}`);
      if (card) { card.style.opacity = "1"; card.style.pointerEvents = "auto"; }
    });
    showToast(`Error: ${err.message}`, "error");
  }
}

async function bulkUnignoreCandidates() {
  if (selectedCandidateIds.size === 0) return;
  const ids = Array.from(selectedCandidateIds);

  ids.forEach(id => {
    const card = document.getElementById(`candidate-card-${id}`);
    if (card) {
      card.style.transition = "opacity 0.2s ease";
      card.style.opacity = "0.3";
      card.style.pointerEvents = "none";
    }
  });

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
      ids.forEach(id => {
        const card = document.getElementById(`candidate-card-${id}`);
        if (card) { card.style.opacity = "1"; card.style.pointerEvents = "auto"; }
      });
      showToast(data.detail || "Failed batch unignore", "error");
    }
  } catch (err) {
    ids.forEach(id => {
      const card = document.getElementById(`candidate-card-${id}`);
      if (card) { card.style.opacity = "1"; card.style.pointerEvents = "auto"; }
    });
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
  const cand = Array.isArray(currentCandidates) ? currentCandidates.find(c => c.id === candidateId) : null;
  const card = document.getElementById(`candidate-card-${candidateId}`);
  if (card) {
    card.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    card.style.opacity = "0.3";
    card.style.pointerEvents = "none";
  }

  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/ignore`, {
      method: "POST"
    });
    if (res.ok) {
      if (cand) {
        quickRuleCandidateContext = cand;
      }
      const toastHtml = `Task candidate ignored. <button class="btn btn-outline btn-xs" style="margin-left:8px; padding:2px 8px; font-size:11px; font-weight:600; cursor:pointer; background:rgba(239, 68, 68, 0.15); border-color:#ef4444; color:#ef4444;" onclick="openQuickRuleModal(${candidateId})">🛡️ Always ignore?</button>`;
      showToast(toastHtml, "info", false, true, 8000);
      loadCandidates();
    } else {
      if (card) {
        card.style.opacity = "1";
        card.style.pointerEvents = "auto";
      }
      const data = await res.json();
      showToast(data.detail || "Failed to ignore candidate", "error");
    }
  } catch (err) {
    if (card) {
      card.style.opacity = "1";
      card.style.pointerEvents = "auto";
    }
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
  const card = document.getElementById(`candidate-card-${candidateId}`);
  if (card) {
    card.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    card.style.opacity = "0.3";
    card.style.pointerEvents = "none";
  }

  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/unignore`, {
      method: "POST"
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Task candidate restored", "info");
      loadCandidates();
    } else {
      if (card) {
        card.style.opacity = "1";
        card.style.pointerEvents = "auto";
      }
      showToast(data.detail || "Failed to restore candidate", "error");
    }
  } catch (err) {
    if (card) {
      card.style.opacity = "1";
      card.style.pointerEvents = "auto";
    }
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
  const loadingToast = showToast("Stage 1/2: Connecting to IMAP mailboxes...", "loading", true);

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
        const syncMsg = payload.message || `Synced ${payload.emails_synced || 0} emails`;
        if (loadingToast) {
          loadingToast.update(syncMsg, "success");
          setTimeout(() => loadingToast.dismiss(), 2000);
        } else {
          showToast(syncMsg, "success");
        }
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

// --- Quick Auto-Ignore Rule Modal Logic ---
let quickRuleCandidateContext = null;

function extractCleanEmailAddress(senderStr) {
  if (!senderStr) return "";
  const match = senderStr.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  return senderStr.trim().toLowerCase();
}

function extractEmailDomainFromSender(senderStr) {
  const addr = extractCleanEmailAddress(senderStr);
  if (addr.includes("@")) {
    return addr.split("@").pop().trim().toLowerCase();
  }
  return addr;
}

function openQuickRuleModal(candidateId) {
  let cand = null;
  if (quickRuleCandidateContext && quickRuleCandidateContext.id === candidateId) {
    cand = quickRuleCandidateContext;
  } else if (Array.isArray(currentCandidates)) {
    cand = currentCandidates.find(c => c.id === candidateId);
  }

  const modal = document.getElementById("quick-rule-modal");
  if (!modal) return;

  const senderEl = document.getElementById("quick-rule-context-sender");
  const subjectEl = document.getElementById("quick-rule-context-subject");
  const nameInput = document.getElementById("quick-rule-name");
  const typeSelect = document.getElementById("quick-rule-type");
  const patternInput = document.getElementById("quick-rule-pattern");
  const retroCheck = document.getElementById("quick-rule-apply-retroactive");

  const sender = cand ? (cand.sender || "") : "";
  const subject = cand ? (cand.subject || "") : "";
  const domain = extractEmailDomainFromSender(sender);
  const cleanAddr = extractCleanEmailAddress(sender);

  quickRuleCandidateContext = cand;

  if (senderEl) senderEl.textContent = sender ? `📧 From: ${sender}` : "📧 From: Unknown Sender";
  if (subjectEl) subjectEl.textContent = subject ? `✉️ Subject: ${subject}` : "✉️ Subject: (No Subject)";

  if (typeSelect) typeSelect.value = "sender_domain";
  if (patternInput) patternInput.value = domain || cleanAddr || "example.com";
  if (nameInput) nameInput.value = domain ? `Auto-Ignore domain: ${domain}` : `Auto-Ignore sender: ${cleanAddr}`;
  if (retroCheck) retroCheck.checked = true;

  modal.classList.add("active");
}

function onQuickRuleTypeChange() {
  const typeSelect = document.getElementById("quick-rule-type");
  const nameInput = document.getElementById("quick-rule-name");
  const patternInput = document.getElementById("quick-rule-pattern");

  if (!typeSelect || !nameInput || !patternInput) return;

  const ruleType = typeSelect.value;
  const cand = quickRuleCandidateContext;
  const sender = cand ? (cand.sender || "") : "";
  const subject = cand ? (cand.subject || "") : "";
  const domain = extractEmailDomainFromSender(sender);
  const cleanAddr = extractCleanEmailAddress(sender);

  if (ruleType === "sender_domain") {
    patternInput.value = domain || cleanAddr;
    nameInput.value = domain ? `Auto-Ignore domain: ${domain}` : `Auto-Ignore domain`;
  } else if (ruleType === "sender_contains") {
    patternInput.value = cleanAddr || sender;
    nameInput.value = cleanAddr ? `Auto-Ignore sender: ${cleanAddr}` : `Auto-Ignore sender`;
  } else if (ruleType === "subject_keyword") {
    const kw = subject ? subject.split(" ").slice(0, 3).join(" ") : "newsletter";
    patternInput.value = kw.toLowerCase();
    nameInput.value = `Auto-Ignore subject: ${kw}`;
  } else if (ruleType === "subject_regex") {
    patternInput.value = subject ? `(${subject.slice(0, 20)})` : ".*";
    nameInput.value = `Auto-Ignore regex rule`;
  }
}

function closeQuickRuleModal(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById("quick-rule-modal");
  if (modal) modal.classList.remove("active");
}

async function submitQuickRule() {
  const nameInput = document.getElementById("quick-rule-name");
  const typeSelect = document.getElementById("quick-rule-type");
  const patternInput = document.getElementById("quick-rule-pattern");
  const retroCheck = document.getElementById("quick-rule-apply-retroactive");
  const submitBtn = document.getElementById("quick-rule-submit-btn");

  const name = nameInput ? nameInput.value.trim() : "";
  const rule_type = typeSelect ? typeSelect.value : "sender_domain";
  const pattern = patternInput ? patternInput.value.trim() : "";
  const applyRetroactive = retroCheck ? retroCheck.checked : true;

  if (!name) {
    showToast("Please enter a rule name", "error");
    return;
  }
  if (!pattern) {
    showToast("Please enter a pattern to match", "error");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "🛡️ Saving Rule...";
  }

  try {
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        rule_type: rule_type,
        pattern: pattern,
        is_active: true
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to create auto-ignore rule");
    }

    let applyMsg = "";
    if (applyRetroactive) {
      const applyRes = await fetch("/api/rules/apply", { method: "POST" });
      if (applyRes.ok) {
        const applyData = await applyRes.json();
        applyMsg = ` ${applyData.ignored_count || 0} candidate(s) ignored retroactively.`;
      }
    }

    showToast(`Auto-Ignore Rule "${name}" created!${applyMsg}`, "success");
    closeQuickRuleModal();
    loadCandidates();
    if (typeof loadAutoIgnoreRules === "function") {
      loadAutoIgnoreRules();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "🛡️ Save & Apply Rule";
    }
  }
}

