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
    await checkPushNotificationStatus();
    await loadSyncHealthStats();
  } catch (err) {
    console.error("Error loading admin settings:", err);
  }
}

async function loadSyncHealthStats() {
  try {
    const res = await fetch("/api/admin/sync-health");
    if (!res.ok) return;
    const data = await res.json();

    const durEl = document.getElementById("sync-stat-duration");
    const timeEl = document.getElementById("sync-stat-time");
    const countEl = document.getElementById("sync-stat-today-count");
    const statusEl = document.getElementById("sync-stat-status");
    const errEl = document.getElementById("sync-stat-error");

    if (durEl) {
      durEl.textContent = `${data.last_sync_duration_seconds || 0.0}s`;
    }
    if (timeEl) {
      timeEl.textContent = data.last_synced_at ? `Last sync: ${formatTimeAgo(data.last_synced_at)}` : "Not synced yet";
    }
    if (countEl) {
      countEl.textContent = `${data.emails_fetched_today || 0} emails`;
    }

    if (statusEl && errEl) {
      if (data.status === "error" || data.last_error) {
        statusEl.textContent = "🔴 Error / Degraded";
        statusEl.style.color = "#ef4444";
        errEl.textContent = data.last_error || "Connection failure";
        errEl.style.color = "#f87171";
      } else {
        statusEl.textContent = "🟢 Operational";
        statusEl.style.color = "#10b981";
        errEl.textContent = "0 connection errors";
        errEl.style.color = "var(--text-muted)";
      }
    }

    await loadSyncChartData();
  } catch (err) {
    console.error("Error loading sync health stats:", err);
  }
}

window.currentSyncChartData = null;

async function loadSyncChartData() {
  const legendEl = document.getElementById("sync-chart-legend");
  const barsEl = document.getElementById("sync-chart-bars-container");
  const labelsEl = document.getElementById("sync-chart-labels-container");
  if (!barsEl || !labelsEl) return;

  try {
    const res = await fetch("/api/admin/sync-chart-data");
    if (!res.ok) return;
    const data = await res.json();
    window.currentSyncChartData = data;

    const days = data.days || [];
    const series = data.series || [];

    if (legendEl) {
      if (series.length === 0) {
        legendEl.innerHTML = `<span style="color:var(--text-dim);">No active accounts</span>`;
      } else {
        legendEl.innerHTML = series.map(s => `
          <span style="display:inline-flex; align-items:center; gap:5px; color:var(--text-main);">
            <span style="width:8px; height:8px; border-radius:50%; background:${s.color}; display:inline-block;"></span>
            ${escapeHtml(s.account_name)}
          </span>
        `).join("");
      }
    }

    const dayTotals = days.map((_, dayIdx) => {
      return series.reduce((sum, s) => sum + (s.counts[dayIdx] || 0), 0);
    });
    const maxVal = Math.max(...dayTotals, 1);

    barsEl.innerHTML = days.map((dayLabel, dayIdx) => {
      const total = dayTotals[dayIdx];

      const breakdownText = series.map(s => {
        const val = s.counts[dayIdx] || 0;
        return `${s.account_name}: ${val}`;
      }).join(" | ");

      const segmentsHtml = series.map(s => {
        const val = s.counts[dayIdx] || 0;
        if (val === 0) return "";
        const pct = ((val / total) * 100).toFixed(1);
        return `
          <div class="chart-segment"
               data-acc="${escapeHtml(s.account_name)}"
               style="height:${pct}%; background:${s.color}; width:100%; transition:all 0.2s ease; cursor:default;">
          </div>
        `;
      }).join("");

      const heightPct = Math.max(Math.round((total / maxVal) * 100), total > 0 ? 8 : 4);

      return `
        <div class="chart-bar-column"
             style="flex:1; display:flex; flex-direction:column; align-items:center; height:100%; justify-content:flex-end;">
          <span style="font-size:9px; color:var(--text-dim); margin-bottom:2px; opacity:${total > 0 ? '1' : '0.4'}; font-weight:600;">${total}</span>
          <div class="chart-bar-pill"
               onmouseenter="this.style.filter='brightness(1.25)'; this.style.boxShadow='0 0 10px rgba(59,130,246,0.4)'; showChartPopover(this, event, ${dayIdx})"
               onmousemove="updateChartPopoverPos(this, event)"
               onmouseleave="this.style.filter='none'; this.style.boxShadow='none'; hideChartPopover()"
               style="width:75%; max-width:28px; height:${heightPct}%; background:rgba(255,255,255,0.04); border-radius:4px 4px 0 0; display:flex; flex-direction:column-reverse; overflow:hidden; border:1px solid rgba(255,255,255,0.08); cursor:default; transition:all 0.15s ease;">
            ${segmentsHtml}
          </div>
        </div>
      `;
    }).join("");

    labelsEl.innerHTML = days.map(dayLabel => `
      <div style="flex:1;">${escapeHtml(dayLabel)}</div>
    `).join("");

  } catch (err) {
    console.error("Error loading sync chart data:", err);
  }
}

function showChartPopover(pillEl, event, dayIdx) {
  const popoverEl = document.getElementById("sync-chart-popover");
  const bodyEl = document.getElementById("sync-chart-popover-body");
  if (!popoverEl || !bodyEl || !window.currentSyncChartData) return;

  const data = window.currentSyncChartData;
  const dayLabel = data.days[dayIdx] || "";
  const series = data.series || [];

  const itemsHtml = series.map(s => {
    const val = s.counts[dayIdx] || 0;
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:3px 6px; border-radius:4px;">
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span style="width:8px; height:8px; border-radius:50%; background:${s.color}; display:inline-block;"></span>
          ${escapeHtml(s.account_name)}
        </span>
        <strong style="color:#60a5fa;">${val} email${val === 1 ? '' : 's'}</strong>
      </div>
    `;
  }).join("");

  const dayTotal = series.reduce((sum, s) => sum + (s.counts[dayIdx] || 0), 0);

  bodyEl.innerHTML = `
    <div style="font-weight:700; color:var(--text-main); margin-bottom:6px; font-size:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <span>📅 ${escapeHtml(dayLabel)}</span>
      <span style="font-size:10px; color:var(--text-dim); font-weight:400;">Day Total: <strong>${dayTotal}</strong></span>
    </div>
    <div style="display:flex; flex-direction:column; gap:2px;">
      ${itemsHtml}
    </div>
  `;

  popoverEl.style.display = "block";
  updateChartPopoverPos(pillEl, event);
}

function updateChartPopoverPos(pillEl, event) {
  const popoverEl = document.getElementById("sync-chart-popover");
  if (!popoverEl) return;

  const targetPill = pillEl || (event && event.currentTarget);
  if (targetPill && targetPill.getBoundingClientRect) {
    const pillRect = targetPill.getBoundingClientRect();
    const popoverRect = popoverEl.getBoundingClientRect();

    let x = pillRect.left + (pillRect.width / 2) - (popoverRect.width / 2);
    let y = pillRect.top - popoverRect.height - 10;

    if (x < 10) x = 10;
    if (x + popoverRect.width > window.innerWidth - 10) {
      x = window.innerWidth - popoverRect.width - 10;
    }

    const arrowEl = document.getElementById("sync-chart-popover-arrow");
    if (y < 10) {
      y = pillRect.bottom + 10;
      if (arrowEl) {
        arrowEl.style.top = "-5px";
        arrowEl.style.bottom = "auto";
        arrowEl.style.transform = "rotate(225deg)";
      }
    } else {
      if (arrowEl) {
        arrowEl.style.bottom = "-5px";
        arrowEl.style.top = "auto";
        arrowEl.style.transform = "rotate(45deg)";
      }
    }

    popoverEl.style.left = `${Math.round(x)}px`;
    popoverEl.style.top = `${Math.round(y)}px`;
  }
}

function hideChartPopover() {
  const popoverEl = document.getElementById("sync-chart-popover");
  if (!popoverEl) return;
  popoverEl.style.display = "none";
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

async function applyAutoIgnoreRulesNow() {
  const btn = document.getElementById("btn-apply-rules-now");
  const origText = btn ? btn.innerHTML : "⚡ Apply Rules Now";

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Applying rules...`;
  }

  try {
    const res = await fetch("/api/rules/apply", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      const msg = data.ignored_count > 0
        ? `Applied rules! ${data.ignored_count} candidate(s) newly marked as IGNORED.`
        : `Applied rules to ${data.evaluated_count} candidate(s). No new matches found.`;
      showToast(msg, data.ignored_count > 0 ? "success" : "info");
      await loadAutoIgnoreRules();
      if (typeof loadInboxStats === "function") {
        await loadInboxStats();
      }
      if (typeof loadCandidates === "function") {
        await loadCandidates();
      }
    } else {
      showToast(data.detail || "Failed to apply auto-ignore rules.", "error");
    }
  } catch (err) {
    showToast(`Error applying rules: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
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

  if (typeof initSyncUpdatesWebSocket === "function") {
    initSyncUpdatesWebSocket();
  }

  if (currentAdminSettings.ui_auto_refresh_enabled) {
    const intervalMs = Math.max((currentAdminSettings.ui_auto_refresh_interval_seconds || 30) * 1000, 10000);
    // Fallback polling only if WebSocket is disconnected
    autoRefreshTimer = setInterval(() => {
      if (typeof syncUpdatesWs !== "undefined" && syncUpdatesWs && syncUpdatesWs.readyState === WebSocket.OPEN) {
        return; // Active WebSocket push handling updates; skip unnecessary HTTP polling
      }
      if (typeof loadCandidates === "function") {
        loadCandidates();
      }
    }, intervalMs);
  }
}

async function checkPushNotificationStatus() {
  const statusEl = document.getElementById("push-status-info");
  if (!statusEl) return;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    statusEl.innerHTML = `<span style="color:#ef4444;">⚠️ Web Push is not supported in this browser environment.</span>`;
    return;
  }

  if (Notification.permission !== "granted") {
    statusEl.innerHTML = `<span style="color:#f59e0b;">⚠️ Notification permission is ${Notification.permission}. Click anywhere or grant permissions to enable.</span>`;
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      statusEl.innerHTML = `<span style="color:#10b981;">✅ Web Push active! Closed-app notifications are enabled on this device.</span>`;
    } else {
      statusEl.innerHTML = `<span style="color:#f59e0b;">⏳ Service worker ready. Registering push subscription...</span>`;
      if (typeof subscribeUserToPush === "function") {
        await subscribeUserToPush(reg);
        const subCheck = await reg.pushManager.getSubscription();
        if (subCheck) {
          statusEl.innerHTML = `<span style="color:#10b981;">✅ Web Push active! Closed-app notifications are enabled on this device.</span>`;
        }
      }
    }
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#ef4444;">⚠️ Web Push status error: ${escapeHtml(err.message)}</span>`;
  }
}

async function sendTestPushNotification() {
  try {
    showToast("Dispatching test Web Push notification...", "info");
    const res = await fetch("/api/notifications/test", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      const stats = data.result || {};
      showToast(`Test push sent! Delivered: ${stats.successful || 0}, Failed: ${stats.failed || 0}`, "success");
      await checkPushNotificationStatus();
    } else {
      showToast(data.detail || "Failed to send test push notification", "error");
    }
  } catch (err) {
    showToast(`Push test error: ${err.message}`, "error");
  }
}

async function runSystemDiagnostics() {
  const btn = document.getElementById("btn-run-diagnostics");
  const container = document.getElementById("diagnostics-results-container");
  const summaryBar = document.getElementById("diagnostics-summary-bar");
  const detailsGrid = document.getElementById("diagnostics-details-grid");

  if (!container || !summaryBar || !detailsGrid) return;

  const origBtnText = btn ? btn.innerHTML : "🧪 Run System Diagnostic";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Testing Systems...`;
  }

  container.style.display = "block";
  summaryBar.innerHTML = `<span style="font-size:13px; color:var(--text-dim);">Running diagnostic tests across IMAP, Notion, AI, WebSocket, and Database...</span>`;
  detailsGrid.innerHTML = `
    <div style="padding:16px; background:rgba(255,255,255,0.02); border-radius:8px; border:1px solid rgba(255,255,255,0.06); text-align:center; color:var(--text-muted); grid-column: 1 / -1;">
      Executing tests...
    </div>
  `;

  try {
    const res = await fetch("/api/admin/diagnostics/run", { method: "POST" });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.detail || "System diagnostics test failed.", "error");
      summaryBar.innerHTML = `<span style="color:#ef4444; font-weight:600;">❌ Diagnostic Execution Error</span>`;
      detailsGrid.innerHTML = `<div style="color:#ef4444; padding:12px; grid-column:1 / -1;">Failed to execute system diagnostics.</div>`;
      return;
    }

    const data = await res.json();
    const results = data.results || {};

    let overallBadge = "";
    if (data.overall_status === "ok") {
      overallBadge = `<span style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); padding:4px 10px; border-radius:20px; font-weight:600; font-size:13px;">🟢 All Systems Operational</span>`;
    } else if (data.overall_status === "warning") {
      overallBadge = `<span style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); padding:4px 10px; border-radius:20px; font-weight:600; font-size:13px;">🟡 Systems Degraded / Unconfigured</span>`;
    } else {
      overallBadge = `<span style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); padding:4px 10px; border-radius:20px; font-weight:600; font-size:13px;">🔴 System Issues Detected</span>`;
    }

    summaryBar.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        ${overallBadge}
        <span style="font-size:12px; color:var(--text-muted);">Completed 5 checks in <strong>${data.total_duration_ms} ms</strong></span>
      </div>
      <span style="font-size:11px; color:var(--text-dim); font-family:monospace;">${new Date(data.timestamp).toLocaleTimeString()}</span>
    `;

    const cardsHtml = Object.keys(results).map(key => {
      const item = results[key];
      let statusIcon = "🟢";
      let statusBg = "rgba(16,185,129,0.05)";
      let statusBorder = "rgba(16,185,129,0.2)";

      if (item.status === "warning") {
        statusIcon = "🟡";
        statusBg = "rgba(245,158,11,0.05)";
        statusBorder = "rgba(245,158,11,0.2)";
      } else if (item.status === "failed") {
        statusIcon = "🔴";
        statusBg = "rgba(239,68,68,0.05)";
        statusBorder = "rgba(239,68,68,0.2)";
      }

      return `
        <div style="background:${statusBg}; border:1px solid ${statusBorder}; padding:14px; border-radius:8px; display:flex; flex-direction:column; justify-content:space-between; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div style="font-weight:600; font-size:13px; color:var(--text-main); display:flex; align-items:center; gap:6px;">
              <span>${statusIcon}</span>
              <span>${escapeHtml(item.name)}</span>
            </div>
            <span style="font-size:11px; font-family:monospace; color:var(--text-muted); background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:4px;">${item.latency_ms} ms</span>
          </div>
          <p style="font-size:12px; color:var(--text-muted); margin:0; line-height:1.4;">
            ${escapeHtml(item.details)}
          </p>
        </div>
      `;
    }).join("");

    detailsGrid.innerHTML = cardsHtml;
    showToast("System diagnostic completed!", "success");

  } catch (err) {
    showToast(`Diagnostic error: ${err.message}`, "error");
    summaryBar.innerHTML = `<span style="color:#ef4444; font-weight:600;">❌ Diagnostic Connection Error</span>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

let currentImportConfigPayload = null;

function exportSystemConfig() {
  const chkSys = document.getElementById("export-opt-system-settings");
  const chkMap = document.getElementById("export-opt-field-mappings");
  const chkRules = document.getElementById("export-opt-auto-ignore-rules");

  const incSys = chkSys ? chkSys.checked : true;
  const incMap = chkMap ? chkMap.checked : true;
  const incRules = chkRules ? chkRules.checked : true;

  if (!incSys && !incMap && !incRules) {
    showToast("Please select at least one configuration item to export.", "warning");
    return;
  }

  showToast("Preparing configuration download...", "info");
  const url = `/api/admin/config/export?include_system_settings=${incSys}&include_field_mappings=${incMap}&include_auto_ignore_rules=${incRules}`;
  window.location.href = url;
}

let loadedImportConfigPayload = null;

async function handleConfigImportFile(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      let configJson = JSON.parse(e.target.result);

      // Support raw rule array or alternative key naming
      if (Array.isArray(configJson)) {
        configJson = { auto_ignore_rules: configJson };
      } else if (configJson && typeof configJson === "object") {
        if (!configJson.auto_ignore_rules && Array.isArray(configJson.rules)) {
          configJson.auto_ignore_rules = configJson.rules;
        }
        if (!configJson.field_mappings && Array.isArray(configJson.mappings)) {
          configJson.field_mappings = configJson.mappings;
        }
        if (!configJson.system_settings && configJson.settings) {
          configJson.system_settings = configJson.settings;
        }
      }

      loadedImportConfigPayload = configJson;
      renderImportConfigPreview(file.name, configJson);
    } catch (err) {
      showToast(`Invalid JSON configuration file: ${err.message}`, "error");
      resetConfigImportPreview();
    }
  };

  reader.readAsText(file);
}

function renderImportConfigPreview(filename, configJson) {
  const initialState = document.getElementById("import-state-initial");
  const previewState = document.getElementById("import-state-preview");
  const fnLabel = document.getElementById("import-preview-filename");

  if (!initialState || !previewState) return;

  if (fnLabel) fnLabel.textContent = filename;

  // System Settings
  const chkSys = document.getElementById("import-chk-sys");
  const lblSys = document.getElementById("import-lbl-sys");
  const badgeSys = document.getElementById("import-badge-sys");
  const hasSys = !!(configJson.system_settings && typeof configJson.system_settings === "object" && Object.keys(configJson.system_settings).length > 0);

  if (chkSys) { chkSys.checked = hasSys; chkSys.disabled = !hasSys; }
  if (lblSys) { lblSys.style.opacity = hasSys ? "1" : "0.5"; lblSys.style.cursor = hasSys ? "pointer" : "not-allowed"; }
  if (badgeSys) {
    badgeSys.textContent = hasSys ? "🟢 Available" : "⚪ Not in file";
    badgeSys.style.background = hasSys ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)";
    badgeSys.style.color = hasSys ? "#10b981" : "var(--text-dim)";
  }

  // Field Mappings
  const chkMap = document.getElementById("import-chk-map");
  const lblMap = document.getElementById("import-lbl-map");
  const badgeMap = document.getElementById("import-badge-map");
  const mapCount = Array.isArray(configJson.field_mappings) ? configJson.field_mappings.length : 0;
  const hasMap = mapCount > 0;

  if (chkMap) { chkMap.checked = hasMap; chkMap.disabled = !hasMap; }
  if (lblMap) { lblMap.style.opacity = hasMap ? "1" : "0.5"; lblMap.style.cursor = hasMap ? "pointer" : "not-allowed"; }
  if (badgeMap) {
    badgeMap.textContent = hasMap ? `🟢 ${mapCount} items` : "⚪ Not in file";
    badgeMap.style.background = hasMap ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)";
    badgeMap.style.color = hasMap ? "#10b981" : "var(--text-dim)";
  }

  // Auto-Ignore Rules
  const chkRules = document.getElementById("import-chk-rules");
  const lblRules = document.getElementById("import-lbl-rules");
  const badgeRules = document.getElementById("import-badge-rules");
  const rulesCount = Array.isArray(configJson.auto_ignore_rules) ? configJson.auto_ignore_rules.length : 0;
  const hasRules = rulesCount > 0;

  if (chkRules) { chkRules.checked = hasRules; chkRules.disabled = !hasRules; }
  if (lblRules) { lblRules.style.opacity = hasRules ? "1" : "0.5"; lblRules.style.cursor = hasRules ? "pointer" : "not-allowed"; }
  if (badgeRules) {
    badgeRules.textContent = hasRules ? `🟢 ${rulesCount} rules` : "⚪ Not in file";
    badgeRules.style.background = hasRules ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)";
    badgeRules.style.color = hasRules ? "#10b981" : "var(--text-dim)";
  }

  initialState.style.display = "none";
  previewState.style.display = "flex";
}

function resetConfigImportPreview() {
  const initialState = document.getElementById("import-state-initial");
  const previewState = document.getElementById("import-state-preview");
  const fileInput = document.getElementById("config-import-input");

  loadedImportConfigPayload = null;
  if (fileInput) fileInput.value = "";
  if (initialState) initialState.style.display = "flex";
  if (previewState) previewState.style.display = "none";
}

async function confirmConfigImport() {
  if (!loadedImportConfigPayload) {
    showToast("No configuration payload found.", "error");
    resetConfigImportPreview();
    return;
  }

  const chkSys = document.getElementById("import-chk-sys");
  const chkMap = document.getElementById("import-chk-map");
  const chkRules = document.getElementById("import-chk-rules");

  const incSys = chkSys && chkSys.checked && !chkSys.disabled;
  const incMap = chkMap && chkMap.checked && !chkMap.disabled;
  const incRules = chkRules && chkRules.checked && !chkRules.disabled;

  if (!incSys && !incMap && !incRules) {
    showToast("Please select at least one configuration section to import.", "warning");
    return;
  }

  const payloadToImport = {};
  if (incSys && loadedImportConfigPayload.system_settings) {
    payloadToImport.system_settings = loadedImportConfigPayload.system_settings;
  }
  if (incMap && loadedImportConfigPayload.field_mappings) {
    payloadToImport.field_mappings = loadedImportConfigPayload.field_mappings;
  }
  if (incRules && loadedImportConfigPayload.auto_ignore_rules) {
    payloadToImport.auto_ignore_rules = loadedImportConfigPayload.auto_ignore_rules;
  }

  const confirmBtn = document.getElementById("btn-confirm-import");
  const origBtnText = confirmBtn ? confirmBtn.innerHTML : "📤 Confirm Import";

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `⏳ Importing...`;
  }

  try {
    const res = await fetch("/api/admin/config/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadToImport)
    });

    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Configuration imported successfully!", "success");
      resetConfigImportPreview();
      await loadAdminSettings();
      if (typeof loadAutoIgnoreRules === "function") {
        await loadAutoIgnoreRules();
      }
      if (typeof loadNotionMapping === "function") {
        await loadNotionMapping();
      }
    } else {
      showToast(data.detail || "Failed to import configuration.", "error");
    }
  } catch (err) {
    showToast(`Error importing configuration: ${err.message}`, "error");
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = origBtnText;
    }
  }
}

async function purgeAllAutoIgnoreRules() {
  if (!confirm("Are you sure you want to delete ALL auto-ignore rules? This action cannot be undone.")) return;
  try {
    showToast("Purging all auto-ignore rules...", "info");
    const res = await fetch("/api/rules/all", { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "All auto-ignore rules purged successfully!", "success");
      await loadAutoIgnoreRules();
    } else {
      showToast(data.detail || "Failed to purge auto-ignore rules.", "error");
    }
  } catch (err) {
    showToast(`Error purging rules: ${err.message}`, "error");
  }
}

async function purgeIgnoredCandidatesNow() {
  if (!confirm("Are you sure you want to purge all candidates currently marked as IGNORED?")) return;
  try {
    showToast("Purging ignored task candidates...", "info");
    const res = await fetch("/api/admin/danger/purge-ignored", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Ignored candidates purged successfully!", "success");
      if (typeof loadCandidates === "function") loadCandidates();
    } else {
      showToast(data.detail || "Failed to purge ignored candidates.", "error");
    }
  } catch (err) {
    showToast(`Error purging ignored candidates: ${err.message}`, "error");
  }
}

async function resetSettingsToDefaults() {
  if (!confirm("Are you sure you want to reset all application settings to factory defaults?")) return;
  try {
    showToast("Resetting settings to factory defaults...", "info");
    const res = await fetch("/api/admin/danger/reset-settings", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Settings reset to defaults successfully!", "success");
      await loadAdminSettings();
    } else {
      showToast(data.detail || "Failed to reset settings.", "error");
    }
  } catch (err) {
    showToast(`Error resetting settings: ${err.message}`, "error");
  }
}





