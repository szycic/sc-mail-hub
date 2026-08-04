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
  } catch (err) {
    console.error("Error loading admin settings:", err);
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
