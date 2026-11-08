/**
 * Email Account Management Controller for SC Mail Hub.
 *
 * Handles account listing, editing (name & color), drag-and-drop reordering,
 * IMAP credential testing, manual synchronization, and account deletion.
 */

const ACCOUNT_COLOR_PALETTE = [
  "#60a5fa", // Sky Blue
  "#34d399", // Emerald Green
  "#a78bfa", // Purple
  "#fbbf24", // Amber Yellow
  "#f472b6", // Pink
  "#38bdf8", // Light Blue
  "#10b981", // Mint Green
  "#f43f5e", // Rose Red
  "#818cf8", // Indigo
  "#fb923c", // Orange
  "#2dd4bf", // Teal
  "#c084fc", // Violet
];

const DRAG_HANDLE_SVG = `
  <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor">
    <circle cx="3.5" cy="3.5" r="1.5" />
    <circle cx="8.5" cy="3.5" r="1.5" />
    <circle cx="3.5" cy="9" r="1.5" />
    <circle cx="8.5" cy="9" r="1.5" />
    <circle cx="3.5" cy="14.5" r="1.5" />
    <circle cx="8.5" cy="14.5" r="1.5" />
  </svg>
`;

let cachedAccounts = [];
let draggedAccountCard = null;

function getAccountColor(acc, idx) {
  if (acc && acc.color && acc.color.trim()) {
    return acc.color.trim();
  }
  return ACCOUNT_COLOR_PALETTE[idx % ACCOUNT_COLOR_PALETTE.length];
}

async function loadAccounts() {
  const listEl = document.getElementById("accounts-list");

  try {
    const res = await fetch("/api/accounts");
    const accounts = await res.json();
    cachedAccounts = accounts;

    const filterAccSelect = document.getElementById("filter-account");
    if (filterAccSelect) {
      try {
        const filterRes = await fetch("/api/accounts/filter-options");
        if (filterRes.ok) {
          const options = await filterRes.json();
          const curVal = filterAccSelect.value || "ALL";
          filterAccSelect.innerHTML = `<option value="ALL">All Accounts</option>` +
            options.map(opt => `<option value="${escapeHtml(opt.email_address)}">${escapeHtml(opt.label)}</option>`).join("");
          filterAccSelect.value = curVal;
        }
      } catch (err) {
        console.error("Filter options load error", err);
      }
    }

    if (!listEl) return;

    if (accounts.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No email accounts connected yet.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = accounts.map((a, idx) => {
      const color = getAccountColor(a, idx);

      return `
        <div class="account-item-card" data-account-id="${a.id}" draggable="true">
          <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
            <!-- Drag Handle -->
            <div class="account-drag-handle" title="Drag to reorder account position">
              ${DRAG_HANDLE_SVG}
            </div>

            <!-- Color indicator badge -->
            <div style="width:14px; height:14px; border-radius:50%; background:${color}; flex-shrink:0; box-shadow:0 0 6px ${color}80; border:2px solid rgba(255,255,255,0.25);" title="Account color: ${color}"></div>

            <!-- Account Details -->
            <div style="min-width:0; overflow:hidden;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <strong style="color:var(--text-main); font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(a.name)}
                </strong>
                <span class="type-pill" style="font-size:10px; padding:1px 6px; background:rgba(255,255,255,0.06); color:var(--text-dim); text-transform:uppercase;">
                  ${escapeHtml(a.provider)}
                </span>
              </div>
              <div style="font-size:12px; color:var(--text-dim); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${escapeHtml(a.email_address)}
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex; gap:6px; flex-shrink:0; margin-left:12px;">
            <button class="btn btn-outline btn-sm" onclick="openEditAccountModal(${a.id})" title="Edit account display name and volume chart color">✏️ Edit</button>
            <button class="btn btn-outline btn-sm" onclick="testAccountConnection(${a.id})" title="Test IMAP SSL connection">🔌 Test</button>
            <button class="btn btn-outline btn-sm" onclick="syncAccount(${a.id})" title="Fetch new emails now">⚡ Sync</button>
            <button class="btn btn-outline btn-sm" style="color:#ef4444;" onclick="openDeleteAccountModal(${a.id}, '${escapeHtml(a.name).replace(/'/g, "\\'")}', '${escapeHtml(a.email_address).replace(/'/g, "\\'")}')" title="Disconnect account">🗑️</button>
          </div>
        </div>
      `;
    }).join("");

    initAccountDragAndDrop(listEl);
  } catch (err) {
    console.error("Accounts load error", err);
  }
}

function initAccountDragAndDrop(containerEl) {
  const cards = containerEl.querySelectorAll(".account-item-card");
  let touchStartCard = null;
  let touchMoved = false;

  cards.forEach(card => {
    // Desktop Drag and Drop
    card.addEventListener("dragstart", (e) => {
      draggedAccountCard = card;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.dataset.accountId);
    });

    card.addEventListener("dragend", () => {
      if (draggedAccountCard) {
        draggedAccountCard.classList.remove("dragging");
        draggedAccountCard = null;
      }
      containerEl.querySelectorAll(".account-item-card").forEach(c => {
        c.classList.remove("drag-over-top", "drag-over-bottom");
      });
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (!draggedAccountCard || draggedAccountCard === card) return;

      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        card.classList.add("drag-over-top");
        card.classList.remove("drag-over-bottom");
      } else {
        card.classList.add("drag-over-bottom");
        card.classList.remove("drag-over-top");
      }
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over-top", "drag-over-bottom");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!draggedAccountCard || draggedAccountCard === card) return;

      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        containerEl.insertBefore(draggedAccountCard, card);
      } else {
        containerEl.insertBefore(draggedAccountCard, card.nextSibling);
      }

      card.classList.remove("drag-over-top", "drag-over-bottom");
      persistAccountOrder();
    });

    // Touch device support via drag handle
    const handle = card.querySelector(".account-drag-handle");
    if (handle) {
      handle.addEventListener("touchstart", () => {
        touchStartCard = card;
        touchMoved = false;
        card.classList.add("dragging");
      }, { passive: true });

      handle.addEventListener("touchmove", (e) => {
        if (!touchStartCard) return;
        touchMoved = true;
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetCard = targetEl ? targetEl.closest(".account-item-card") : null;

        containerEl.querySelectorAll(".account-item-card").forEach(c => {
          c.classList.remove("drag-over-top", "drag-over-bottom");
        });

        if (targetCard && targetCard !== touchStartCard) {
          const rect = targetCard.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (touch.clientY < midY) {
            targetCard.classList.add("drag-over-top");
          } else {
            targetCard.classList.add("drag-over-bottom");
          }
        }
      }, { passive: true });

      handle.addEventListener("touchend", (e) => {
        if (!touchStartCard) return;
        card.classList.remove("dragging");

        if (touchMoved) {
          const touch = e.changedTouches[0];
          const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
          const targetCard = targetEl ? targetEl.closest(".account-item-card") : null;

          if (targetCard && targetCard !== touchStartCard) {
            const rect = targetCard.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (touch.clientY < midY) {
              containerEl.insertBefore(touchStartCard, targetCard);
            } else {
              containerEl.insertBefore(touchStartCard, targetCard.nextSibling);
            }
            persistAccountOrder();
          }
        }

        containerEl.querySelectorAll(".account-item-card").forEach(c => {
          c.classList.remove("drag-over-top", "drag-over-bottom");
        });
        touchStartCard = null;
        touchMoved = false;
      });
    }
  });
}

async function moveAccountOrder(accId, direction) {
  const listEl = document.getElementById("accounts-list");
  if (!listEl) return;

  const card = listEl.querySelector(`.account-item-card[data-account-id="${accId}"]`);
  if (!card) return;

  if (direction === -1) {
    const prev = card.previousElementSibling;
    if (prev && prev.classList.contains("account-item-card")) {
      listEl.insertBefore(card, prev);
      await persistAccountOrder();
    }
  } else if (direction === 1) {
    const next = card.nextElementSibling;
    if (next && next.classList.contains("account-item-card")) {
      listEl.insertBefore(next, card);
      await persistAccountOrder();
    }
  }
}

async function persistAccountOrder() {
  const listEl = document.getElementById("accounts-list");
  if (!listEl) return;

  const cards = listEl.querySelectorAll(".account-item-card");
  const accountIds = Array.from(cards).map(c => parseInt(c.dataset.accountId)).filter(id => !isNaN(id));

  if (accountIds.length === 0) return;

  // Update disabled state on up/down buttons immediately in DOM
  cards.forEach((c, idx) => {
    const upBtn = c.querySelector('button[title="Move Up"]');
    const downBtn = c.querySelector('button[title="Move Down"]');
    if (upBtn) upBtn.disabled = (idx === 0);
    if (downBtn) downBtn.disabled = (idx === cards.length - 1);
  });

  try {
    const res = await fetch("/api/accounts/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_ids: accountIds })
    });
    if (res.ok) {
      if (typeof showToast === "function") {
        showToast("Account display order saved", "success");
      }
      refreshAdminVolumeStats();
    } else {
      const err = await res.json();
      if (typeof showToast === "function") {
        showToast(err.detail || "Failed to save account order", "error");
      }
    }
  } catch (err) {
    console.error("Account reorder error:", err);
    if (typeof showToast === "function") {
      showToast(`Reorder error: ${err.message}`, "error");
    }
  }
}

function refreshAdminVolumeStats() {
  if (typeof loadSyncHealthStats === "function") {
    loadSyncHealthStats();
  }
}

// --- Edit Account Modal ---
let selectedEditColor = "#60a5fa";

function openEditAccountModal(accId) {
  const account = cachedAccounts.find(a => a.id === accId);
  if (!account) return;

  const modal = document.getElementById("edit-account-modal");
  const idInput = document.getElementById("edit-acc-id");
  const nameInput = document.getElementById("edit-acc-name-input");
  const emailDisplay = document.getElementById("edit-acc-email-display");
  const providerPill = document.getElementById("edit-acc-provider-pill");
  const swatchesContainer = document.getElementById("edit-acc-swatches");
  const customColorInput = document.getElementById("edit-acc-custom-color");
  const hexLabel = document.getElementById("edit-acc-hex-label");

  if (!modal) return;

  idInput.value = account.id;
  nameInput.value = account.name || "";
  if (emailDisplay) emailDisplay.textContent = account.email_address || "";
  if (providerPill) providerPill.textContent = (account.provider || "IMAP").toUpperCase();

  const accountIdx = cachedAccounts.findIndex(a => a.id === accId);
  selectedEditColor = getAccountColor(account, accountIdx);

  if (customColorInput) customColorInput.value = selectedEditColor;
  if (hexLabel) hexLabel.textContent = selectedEditColor;

  if (swatchesContainer) {
    swatchesContainer.innerHTML = ACCOUNT_COLOR_PALETTE.map(c => `
      <button type="button" class="color-swatch-btn ${c.toLowerCase() === selectedEditColor.toLowerCase() ? 'selected' : ''}"
        style="background:${c};"
        onclick="selectEditAccountColor('${c}')"
        title="Color ${c}">
      </button>
    `).join("");
  }

  updateEditAccountPreview();
  modal.classList.add("active");
  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 50);
}

function closeEditAccountModal(e) {
  if (e && e.target && !e.target.classList.contains("modal-overlay")) return;
  const modal = document.getElementById("edit-account-modal");
  if (modal) modal.classList.remove("active");
}

function selectEditAccountColor(color) {
  selectedEditColor = color;
  const swatchesContainer = document.getElementById("edit-acc-swatches");
  if (swatchesContainer) {
    swatchesContainer.querySelectorAll(".color-swatch-btn").forEach(btn => {
      const btnBg = btn.style.backgroundColor;
      btn.classList.toggle("selected", btn.title.toLowerCase().includes(color.toLowerCase()));
    });
  }

  const customColorInput = document.getElementById("edit-acc-custom-color");
  const hexLabel = document.getElementById("edit-acc-hex-label");
  if (customColorInput) customColorInput.value = color;
  if (hexLabel) hexLabel.textContent = color;

  updateEditAccountPreview();
}

function onCustomColorPick(val) {
  selectedEditColor = val;
  const swatchesContainer = document.getElementById("edit-acc-swatches");
  if (swatchesContainer) {
    swatchesContainer.querySelectorAll(".color-swatch-btn").forEach(btn => {
      btn.classList.toggle("selected", btn.title.toLowerCase().includes(val.toLowerCase()));
    });
  }
  const hexLabel = document.getElementById("edit-acc-hex-label");
  if (hexLabel) hexLabel.textContent = val;

  updateEditAccountPreview();
}

function updateEditAccountPreview() {
  const nameInput = document.getElementById("edit-acc-name-input");
  const previewText = document.getElementById("edit-acc-preview-text");
  const previewDot = document.getElementById("edit-acc-preview-dot");
  const previewChip = document.getElementById("edit-acc-preview-chip");

  const nameVal = nameInput && nameInput.value.trim() ? nameInput.value.trim() : "Account";

  if (previewText) previewText.textContent = nameVal;
  if (previewDot) previewDot.style.background = selectedEditColor;
  if (previewChip) {
    previewChip.style.borderColor = selectedEditColor;
    previewChip.style.boxShadow = `0 0 10px ${selectedEditColor}40`;
  }
}

async function submitEditAccountModal() {
  const idInput = document.getElementById("edit-acc-id");
  const nameInput = document.getElementById("edit-acc-name-input");

  const accId = parseInt(idInput.value);
  const name = nameInput.value.trim();

  if (!name) {
    if (typeof showToast === "function") {
      showToast("Please enter an account name", "error");
    }
    return;
  }

  try {
    const res = await fetch(`/api/accounts/${accId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        color: selectedEditColor
      })
    });

    if (res.ok) {
      if (typeof showToast === "function") {
        showToast("Account settings updated successfully!", "success");
      }
      closeEditAccountModal();
      await loadAccounts();
      refreshAdminVolumeStats();
    } else {
      const err = await res.json();
      if (typeof showToast === "function") {
        showToast(err.detail || "Failed to update account", "error");
      }
    }
  } catch (err) {
    console.error("Account update error:", err);
    if (typeof showToast === "function") {
      showToast(`Update error: ${err.message}`, "error");
    }
  }
}

// Expose modal functions to window
window.openEditAccountModal = openEditAccountModal;
window.closeEditAccountModal = closeEditAccountModal;
window.selectEditAccountColor = selectEditAccountColor;
window.onCustomColorPick = onCustomColorPick;
window.updateEditAccountPreview = updateEditAccountPreview;
window.submitEditAccountModal = submitEditAccountModal;
window.moveAccountOrder = moveAccountOrder;

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
  const syncToast = showToast("Sync in progress: fetching emails from IMAP mailbox...", "loading", true);
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

let activeDeleteAccountId = null;

function openDeleteAccountModal(accId, name, email) {
  activeDeleteAccountId = accId;
  const nameEl = document.getElementById("delete-account-name-display");
  const emailEl = document.getElementById("delete-account-email-display");
  if (nameEl) nameEl.textContent = name || "Email Account";
  if (emailEl) emailEl.textContent = email || "";

  const modal = document.getElementById("delete-account-modal");
  if (modal) modal.classList.add("active");
}

function closeDeleteAccountModal(e) {
  if (e && e.target && !e.target.classList.contains("modal-overlay")) return;
  const modal = document.getElementById("delete-account-modal");
  if (modal) modal.classList.remove("active");
  activeDeleteAccountId = null;
}

async function submitDeleteAccountModal() {
  const selected = document.querySelector('input[name="delete_email_option"]:checked');
  const deleteEmails = selected ? selected.value === "true" : false;
  await confirmDeleteAccount(deleteEmails);
}

async function confirmDeleteAccount(deleteEmails) {
  if (!activeDeleteAccountId) return;
  const accId = activeDeleteAccountId;
  closeDeleteAccountModal();

  try {
    const res = await fetch(`/api/accounts/${accId}?delete_emails=${deleteEmails}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      showToast(deleteEmails ? "Account and associated emails removed." : "Account removed. Emails retained in Inbox.", "info");
      loadAccounts();
      if (typeof loadCandidates === "function") {
        loadCandidates();
      }
    } else {
      showToast(data.detail || "Failed to remove account", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}
