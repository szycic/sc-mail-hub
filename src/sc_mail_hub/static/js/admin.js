/**
 * Admin Panel Controller & System Settings Management for SC Mail Hub.
 */

let autoRefreshTimer = null;
let currentAdminSettings = {
  imap_sync_enabled: true,
  imap_sync_interval_seconds: 300,
  ui_auto_refresh_enabled: true,
  ui_auto_refresh_interval_seconds: 30,
  auto_purge_synced_enabled: false,
  purge_synced_days: 30,
  auto_purge_ignored_enabled: false,
  purge_ignored_days: 30
};

async function loadAdminSettings() {
  try {
    const res = await fetch("/api/admin/settings");
    if (!res.ok) return;
    const data = await res.json();
    currentAdminSettings = data;

    // IMAP Sync Controls
    const imapToggle = document.getElementById("admin-imap-sync-toggle");
    if (imapToggle) {
      imapToggle.checked = !!data.imap_sync_enabled;
    }
    const imapInterval = document.getElementById("admin-imap-sync-interval");
    if (imapInterval) {
      imapInterval.value = data.imap_sync_interval_seconds || 300;
    }

    // UI Auto Refresh Controls
    const uiToggle = document.getElementById("admin-ui-refresh-toggle");
    if (uiToggle) {
      uiToggle.checked = !!data.ui_auto_refresh_enabled;
    }
    const uiInterval = document.getElementById("admin-ui-refresh-interval");
    if (uiInterval) {
      uiInterval.value = data.ui_auto_refresh_interval_seconds || 30;
    }

    // Auto Purge Controls
    const purgeSyncedToggle = document.getElementById("admin-purge-synced-toggle");
    if (purgeSyncedToggle) {
      purgeSyncedToggle.checked = !!data.auto_purge_synced_enabled;
    }
    const purgeSyncedDays = document.getElementById("admin-purge-synced-days");
    if (purgeSyncedDays) {
      purgeSyncedDays.value = data.purge_synced_days || 30;
    }

    const purgeIgnoredToggle = document.getElementById("admin-purge-ignored-toggle");
    if (purgeIgnoredToggle) {
      purgeIgnoredToggle.checked = !!data.auto_purge_ignored_enabled;
    }
    const purgeIgnoredDays = document.getElementById("admin-purge-ignored-days");
    if (purgeIgnoredDays) {
      purgeIgnoredDays.value = data.purge_ignored_days || 30;
    }

    setupAutoRefreshTimer();
    await loadAutoIgnoreRules();
  } catch (err) {
    console.error("Error loading admin settings:", err);
  }
}

async function loadAutoIgnoreRules() {
  const tbody = document.getElementById("rules-table-body");
  if (!tbody) return;

  try {
    const res = await fetch("/api/rules");
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:16px; text-align:center; color:var(--text-dim);">Failed to load auto-ignore rules.</td></tr>`;
      return;
    }

    const rules = await res.json();
    if (!rules || rules.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:16px; text-align:center; color:var(--text-dim);">No auto-ignore rules configured. Add a rule above to automatically filter incoming emails.</td></tr>`;
      return;
    }

    const typeLabels = {
      sender_domain: "Sender Domain",
      sender_contains: "Sender Substring",
      subject_keyword: "Subject Keyword",
      subject_regex: "Subject Regex"
    };

    tbody.innerHTML = rules.map(rule => `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05); transition: background 0.2s ease;">
        <td style="padding:12px; font-weight:600; color:var(--text-dim);">#${rule.id}</td>
        <td style="padding:12px; font-weight:600; color:var(--text-main);">${escapeHtml(rule.name)}</td>
        <td style="padding:12px;"><span class="type-pill">${typeLabels[rule.rule_type] || rule.rule_type}</span></td>
        <td style="padding:12px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; color:#60a5fa; background:rgba(0,0,0,0.2); border-radius:4px; padding:4px 8px; display:inline-block; margin-top:8px;">${escapeHtml(rule.pattern)}</td>
        <td style="padding:12px; text-align:center;">
          <input type="checkbox" ${rule.is_active ? 'checked' : ''} onchange="toggleAutoIgnoreRule(${rule.id}, this.checked)" style="width:16px; height:16px; cursor:pointer; accent-color:var(--accent-gradient);">
        </td>
        <td style="padding:12px; text-align:right;">
          <button class="btn btn-outline btn-sm" onclick="deleteAutoIgnoreRule(${rule.id})" style="color:#ef4444; border-color:rgba(239,68,68,0.3); background:rgba(239,68,68,0.05);">
            🗑️ Delete
          </button>
        </td>
      </tr>
    `).join("");


  } catch (err) {
    console.error("Error loading auto-ignore rules:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="padding:16px; text-align:center; color:#ef4444;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }

}

async function addAutoIgnoreRule(event) {
  if (event) event.preventDefault();

  const nameInput = document.getElementById("rule-name");
  const typeInput = document.getElementById("rule-type");
  const patternInput = document.getElementById("rule-pattern");

  const payload = {
    name: nameInput ? nameInput.value.trim() : "",
    rule_type: typeInput ? typeInput.value : "sender_domain",
    pattern: patternInput ? patternInput.value.trim() : "",
    is_active: true
  };

  if (!payload.name || !payload.pattern) {
    showToast("Please provide both a Rule Name and Matching Pattern.", "warning");
    return;
  }

  try {
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Rule '${data.name}' created successfully!`, "success");
      if (nameInput) nameInput.value = "";
      if (patternInput) patternInput.value = "";
      await loadAutoIgnoreRules();
    } else {
      showToast(data.detail || "Failed to create rule.", "error");
    }
  } catch (err) {
    showToast(`Error creating rule: ${err.message}`, "error");
  }
}

async function toggleAutoIgnoreRule(ruleId, activeState) {
  try {
    const res = await fetch(`/api/rules/${ruleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: activeState })
    });
    if (res.ok) {
      showToast(`Rule updated.`, "success");
    } else {
      const data = await res.json();
      showToast(data.detail || "Failed to update rule state.", "error");
      await loadAutoIgnoreRules();
    }
  } catch (err) {
    showToast(`Error updating rule: ${err.message}`, "error");
    await loadAutoIgnoreRules();
  }
}

async function deleteAutoIgnoreRule(ruleId) {
  if (!confirm("Are you sure you want to delete this auto-ignore rule?")) return;

  try {
    const res = await fetch(`/api/rules/${ruleId}`, { method: "DELETE" });
    if (res.ok) {
      showToast("Rule deleted successfully.", "success");
      await loadAutoIgnoreRules();
    } else {
      const data = await res.json();
      showToast(data.detail || "Failed to delete rule.", "error");
    }
  } catch (err) {
    showToast(`Error deleting rule: ${err.message}`, "error");
  }
}

async function testAutoIgnoreRules() {
  const senderInput = document.getElementById("test-rule-sender");
  const subjectInput = document.getElementById("test-rule-subject");
  const resultDiv = document.getElementById("test-rule-result");

  const sender = senderInput ? senderInput.value.trim() : "";
  const subject = subjectInput ? subjectInput.value.trim() : "";

  if (!resultDiv) return;

  if (!sender && !subject) {
    resultDiv.innerHTML = `<span style="color:#f59e0b;">⚠️ Please enter a sample sender or subject to test.</span>`;
    return;
  }

  resultDiv.innerHTML = `<span style="color:var(--text-dim);">Testing rules...</span>`;

  try {
    const res = await fetch("/api/rules/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender, subject })
    });
    const data = await res.json();

    if (res.ok) {
      if (data.matched && data.matched_rule) {
        resultDiv.innerHTML = `<span style="color:#10b981;">✅ MATCHED Rule ID=${data.matched_rule.id}: <strong>${escapeHtml(data.matched_rule.name)}</strong> (${escapeHtml(data.matched_rule.pattern)})</span>`;
      } else {
        resultDiv.innerHTML = `<span style="color:var(--text-dim);">ℹ️ No active rule matched this email sample (Candidate would remain PENDING).</span>`;
      }
    } else {
      resultDiv.innerHTML = `<span style="color:#ef4444;">Error testing rules.</span>`;
    }
  } catch (err) {
    resultDiv.innerHTML = `<span style="color:#ef4444;">Error: ${escapeHtml(err.message)}</span>`;
  }
}

async function seedPresetAutoIgnoreRules() {
  try {
    const res = await fetch("/api/rules/seed-defaults", { method: "POST" });
    if (res.ok) {
      showToast("Typical preset auto-ignore rules loaded successfully!", "success");
      await loadAutoIgnoreRules();
    } else {
      const data = await res.json();
      showToast(data.detail || "Failed to load preset rules.", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

async function saveAdminSettings(event) {



  if (event) event.preventDefault();

  const imapToggle = document.getElementById("admin-imap-sync-toggle");
  const imapInterval = document.getElementById("admin-imap-sync-interval");
  const uiToggle = document.getElementById("admin-ui-refresh-toggle");
  const uiInterval = document.getElementById("admin-ui-refresh-interval");

  const purgeSyncedToggle = document.getElementById("admin-purge-synced-toggle");
  const purgeSyncedDays = document.getElementById("admin-purge-synced-days");
  const purgeIgnoredToggle = document.getElementById("admin-purge-ignored-toggle");
  const purgeIgnoredDays = document.getElementById("admin-purge-ignored-days");

  const payload = {
    imap_sync_enabled: imapToggle ? imapToggle.checked : true,
    imap_sync_interval_seconds: imapInterval ? parseInt(imapInterval.value, 10) || 300 : 300,
    ui_auto_refresh_enabled: uiToggle ? uiToggle.checked : true,
    ui_auto_refresh_interval_seconds: uiInterval ? parseInt(uiInterval.value, 10) || 30 : 30,
    auto_purge_synced_enabled: purgeSyncedToggle ? purgeSyncedToggle.checked : false,
    purge_synced_days: purgeSyncedDays ? parseInt(purgeSyncedDays.value, 10) || 30 : 30,
    auto_purge_ignored_enabled: purgeIgnoredToggle ? purgeIgnoredToggle.checked : false,
    purge_ignored_days: purgeIgnoredDays ? parseInt(purgeIgnoredDays.value, 10) || 30 : 30
  };

  try {
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      currentAdminSettings = data;
      showToast("System settings saved successfully!", "success");
      setupAutoRefreshTimer();
    } else {
      showToast(data.detail || "Failed to save system settings.", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function setupAutoRefreshTimer() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (currentAdminSettings.ui_auto_refresh_enabled) {
    const intervalMs = Math.max((currentAdminSettings.ui_auto_refresh_interval_seconds || 30) * 1000, 5000);
    autoRefreshTimer = setInterval(() => {
      if (typeof loadCandidates === "function") {
        loadCandidates();
      }
    }, intervalMs);
  }
}
