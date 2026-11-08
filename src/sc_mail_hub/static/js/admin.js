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

    const backupRetentionDays = document.getElementById("admin-backup-retention-days");
    if (backupRetentionDays) {
      backupRetentionDays.value = data.backup_retention_days || 14;
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
    const tzOffset = new Date().getTimezoneOffset();
    const res = await fetch(`/api/admin/sync-health?tz_offset=${tzOffset}`);
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
      if (data.last_synced_at) {
        timeEl.title = `Last synced at ${formatDateTime(data.last_synced_at)}`;
      } else {
        timeEl.removeAttribute("title");
      }
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

    const dbStatusEl = document.getElementById("sync-stat-db-status");
    const dbSubEl = document.getElementById("sync-stat-db-sub");
    if (dbStatusEl && dbSubEl) {
      const dbHealth = data.db_health;
      if (dbHealth && dbHealth.is_healthy) {
        dbStatusEl.textContent = `🟢 Healthy (${dbHealth.size_mb || 0} MB)`;
        dbStatusEl.style.color = "#10b981";
        const backupInfo = dbHealth.last_backup
          ? `Backup: ${formatTimeAgo(dbHealth.last_backup.created_at)}`
          : `${dbHealth.total_backups || 0} backups`;
        dbSubEl.textContent = `Quick-check OK • ${backupInfo}`;
        dbSubEl.style.color = "var(--text-muted)";
      } else if (dbHealth) {
        dbStatusEl.textContent = "🔴 Corruption / Error";
        dbStatusEl.style.color = "#ef4444";
        dbSubEl.textContent = dbHealth.message || "Integrity check failed";
        dbSubEl.style.color = "#f87171";
      }
    }

    if (window.activeIngestionView === "calendar") {
      await loadIngestionCalendar(window.currentCalendarYear, window.currentCalendarMonth);
    } else {
      await loadSyncChartData();
    }
  } catch (err) {
    console.error("Error loading sync health stats:", err);
  }
}

window.activeIngestionView = "chart";
window.currentCalendarYear = null;
window.currentCalendarMonth = null;
window.currentCalendarData = null;
window.currentSyncChartData = null;
window.calendarAccountFilter = "all";
let activePopoverEl = null;
let activePopoverType = null;
let activePopoverDateStr = null;
let activePopoverDayIdx = null;
let lastPopoverShowTime = 0;
let lastTouchTimestamp = 0;

async function triggerManualDbBackup(btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = "⏳...";
  }
  try {
    const res = await fetch("/api/admin/database/backup", { method: "POST" });
    const result = await res.json();
    if (res.ok && result.success) {
      if (typeof showToast === "function") {
        showToast(`Backup created: ${result.filename} (${result.size_mb} MB)`, "success");
      }
      await loadSyncHealthStats();
    } else {
      if (typeof showToast === "function") {
        showToast(`Backup failed: ${result.detail || result.error || "Unknown error"}`, "error");
      }
    }
  } catch (err) {
    console.error("Backup request error:", err);
    if (typeof showToast === "function") {
      showToast(`Backup error: ${err.message}`, "error");
    }
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = "💾 Backup";
    }
  }
}
window.triggerManualDbBackup = triggerManualDbBackup;

let popoverHideTimer = null;
let isMouseInPopover = false;

function scheduleHidePopover() {
  if (isRecentTouch()) return;
  if (popoverHideTimer) clearTimeout(popoverHideTimer);
  popoverHideTimer = setTimeout(() => {
    if (!isMouseInPopover) {
      hideChartPopover();
    }
  }, 120);
}

function cancelHidePopover() {
  if (popoverHideTimer) {
    clearTimeout(popoverHideTimer);
    popoverHideTimer = null;
  }
}

function initPopoverHoverListeners() {
  const popoverEl = document.getElementById("sync-chart-popover");
  if (popoverEl && !popoverEl.dataset.hoverBound) {
    popoverEl.dataset.hoverBound = "true";
    popoverEl.addEventListener("mouseenter", () => {
      isMouseInPopover = true;
      cancelHidePopover();
    });
    popoverEl.addEventListener("mouseleave", () => {
      isMouseInPopover = false;
      scheduleHidePopover();
    });
  }
}

function onLegendAccountClick(accId, event) {
  if (event) {
    event.stopPropagation();
  }

  const clickedInsidePopover = Boolean(event && event.target && event.target.closest("#sync-chart-popover"));

  if (!window.selectedAccounts) {
    window.selectedAccounts = new Set();
  }

  const allSeries = (window.activeIngestionView === "calendar"
    ? window.currentCalendarData?.series
    : window.currentSyncChartData?.series) || [];

  if (accId === "all") {
    window.selectedAccounts.clear();
  } else {
    // If Shift/Alt click while in "All" mode: select all accounts EXCEPT this one (exclude)
    if (event && (event.shiftKey || event.altKey) && window.selectedAccounts.size === 0 && allSeries.length > 1) {
      allSeries.forEach(s => {
        if (s.account_id !== accId) {
          window.selectedAccounts.add(s.account_id);
        }
      });
    } else if (window.selectedAccounts.size === 0) {
      // First account clicked while in "All" mode: focus on this single account
      window.selectedAccounts.add(accId);
    } else {
      // Multiple-select toggle
      if (window.selectedAccounts.has(accId)) {
        window.selectedAccounts.delete(accId);
      } else {
        window.selectedAccounts.add(accId);
      }
      // If user selected all available accounts, or deselected all, reset to "All" mode
      if (window.selectedAccounts.size === 0 || (allSeries.length > 0 && window.selectedAccounts.size >= allSeries.length)) {
        window.selectedAccounts.clear();
      }
    }
  }

  // Sync legacy variable
  if (window.selectedAccounts.size === 0) {
    window.calendarAccountFilter = "all";
  } else if (window.selectedAccounts.size === 1) {
    window.calendarAccountFilter = Array.from(window.selectedAccounts)[0];
  } else {
    window.calendarAccountFilter = Array.from(window.selectedAccounts);
  }

  // Only hide popover if the click originated from outside of it
  if (!clickedInsidePopover) {
    hideChartPopover();
  }

  if (window.activeIngestionView === "calendar") {
    if (window.currentCalendarData) {
      renderIngestionCalendar(window.currentCalendarData);
    }
    // If popover was open and clicked inside, refresh it in place without closing
    if (clickedInsidePopover && activePopoverType === "calendar" && activePopoverDateStr) {
      const gridEl = document.getElementById("ingestion-calendar-grid");
      const newCellEl = gridEl ? gridEl.querySelector(`[data-date="${activePopoverDateStr}"]`) : null;
      if (newCellEl) {
        showCalendarDayPopover(newCellEl, null, activePopoverDateStr);
      }
    }
  } else {
    if (window.currentSyncChartData) {
      renderSyncChartData(window.currentSyncChartData);
    }
    // If chart popover was open and clicked inside, refresh it in place without closing
    if (clickedInsidePopover && activePopoverType === "chart" && activePopoverDayIdx !== null) {
      const barsEl = document.getElementById("sync-chart-bars-container");
      const pills = barsEl ? barsEl.querySelectorAll(".chart-bar-pill") : [];
      const newPillEl = pills[activePopoverDayIdx];
      if (newPillEl) {
        showChartPopover(newPillEl, null, activePopoverDayIdx);
      }
    }
  }
}
window.onLegendAccountClick = onLegendAccountClick;
window.onCalendarAccountFilterChange = onLegendAccountClick;

function renderAccountFilterLegend(series) {
  const legendEl = document.getElementById("sync-chart-legend");
  if (!legendEl) return;

  if (!series || series.length === 0) {
    legendEl.innerHTML = `<span style="color:var(--text-dim); font-size:11px;">No active accounts</span>`;
    return;
  }

  if (!window.selectedAccounts) {
    window.selectedAccounts = new Set();
    if (window.calendarAccountFilter && window.calendarAccountFilter !== "all") {
      if (Array.isArray(window.calendarAccountFilter)) {
        window.selectedAccounts = new Set(window.calendarAccountFilter);
      } else {
        window.selectedAccounts = new Set([window.calendarAccountFilter]);
      }
    }
  }

  const isAll = window.selectedAccounts.size === 0;

  let html = `
    <button type="button" class="legend-filter-chip ${isAll ? 'active' : 'dimmed'}"
      onclick="onLegendAccountClick('all', event)"
      title="Show all accounts">
      <span>👥 All Accounts</span>
    </button>
  `;

  html += series.map(s => {
    const isSelected = !isAll && window.selectedAccounts.has(s.account_id);
    const isDimmed = !isAll && !isSelected;
    const activeClass = isSelected ? 'active' : (isDimmed ? 'dimmed' : '');
    const activeStyle = isSelected ? `border-color:${s.color}; box-shadow:0 0 8px ${s.color}50;` : '';
    const titleText = isSelected
      ? `Click to deselect ${escapeHtml(s.account_name)}`
      : (isAll ? `Filter by ${escapeHtml(s.account_name)} (Shift+click to exclude)` : `Add ${escapeHtml(s.account_name)} to filter`);
    return `
      <button type="button" class="legend-filter-chip ${activeClass}" style="${activeStyle}"
        onclick="onLegendAccountClick('${escapeHtml(s.account_id)}', event)"
        title="${titleText}">
        <span style="width:8px; height:8px; border-radius:50%; background:${s.color}; display:inline-block; flex-shrink:0;"></span>
        <span>${escapeHtml(s.account_name)}</span>
        ${isSelected ? `<span style="font-size:10px; margin-left:3px; opacity:0.8;">✕</span>` : ''}
      </button>
    `;
  }).join("");

  legendEl.innerHTML = html;
}
window.renderAccountFilterLegend = renderAccountFilterLegend;

window.addEventListener("touchstart", () => {
  lastTouchTimestamp = Date.now();
}, { passive: true, capture: true });

function isRecentTouch() {
  return (Date.now() - lastTouchTimestamp) < 1200;
}

function switchIngestionView(viewType) {
  window.activeIngestionView = viewType;
  const chartViewEl = document.getElementById("ingestion-chart-view");
  const calViewEl = document.getElementById("ingestion-calendar-view");
  const btnChart = document.getElementById("btn-ingestion-view-chart");
  const btnCal = document.getElementById("btn-ingestion-view-calendar");
  const headingEl = document.getElementById("ingestion-viz-heading");

  hideChartPopover();

  if (viewType === "calendar") {
    if (chartViewEl) chartViewEl.style.display = "none";
    if (calViewEl) calViewEl.style.display = "block";
    if (btnChart) {
      btnChart.classList.remove("btn-primary", "active");
      btnChart.classList.add("btn-ghost");
    }
    if (btnCal) {
      btnCal.classList.remove("btn-ghost");
      btnCal.classList.add("btn-primary", "active");
    }
    if (headingEl) {
      headingEl.innerHTML = `📅 Email Volume Calendar <span style="font-size:11px; font-weight:400; color:var(--text-dim); margin-left:4px;">• Hover or tap days for breakdown</span>`;
    }
    if (window.currentCalendarData) {
      renderIngestionCalendar(window.currentCalendarData);
    } else {
      loadIngestionCalendar();
    }
  } else {
    if (chartViewEl) chartViewEl.style.display = "block";
    if (calViewEl) calViewEl.style.display = "none";
    if (btnChart) {
      btnChart.classList.remove("btn-ghost");
      btnChart.classList.add("btn-primary", "active");
    }
    if (btnCal) {
      btnCal.classList.remove("btn-primary", "active");
      btnCal.classList.add("btn-ghost");
    }
    if (headingEl) {
      headingEl.innerHTML = `📈 7-Day Email Volume <span style="font-size:11px; font-weight:400; color:var(--text-dim); margin-left:4px;">• Hover or tap bars for breakdown</span>`;
    }
    if (window.currentSyncChartData) {
      renderSyncChartData(window.currentSyncChartData);
    } else {
      loadSyncChartData();
    }
  }
}

async function loadIngestionCalendar(year, month) {
  const gridEl = document.getElementById("ingestion-calendar-grid");
  if (gridEl && !window.currentCalendarData) {
    gridEl.innerHTML = `<div style="grid-column:1/-1; padding:24px; text-align:center; color:var(--text-dim); font-size:12px;">Loading email volume calendar...</div>`;
  }
  try {
    const tzOffset = new Date().getTimezoneOffset();
    let url = `/api/admin/ingestion-calendar-data?tz_offset=${tzOffset}`;
    if (year && month) {
      url += `&year=${year}&month=${month}`;
    }
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    window.currentCalendarData = data;
    window.currentCalendarYear = data.year;
    window.currentCalendarMonth = data.month;

    renderIngestionCalendar(data);
  } catch (err) {
    console.error("Error loading ingestion calendar:", err);
    if (gridEl) {
      gridEl.innerHTML = `<div style="grid-column:1/-1; padding:24px; text-align:center; color:#ef4444; font-size:12px;">Failed to load calendar data.</div>`;
    }
  }
}

function navCalendarMonth(delta) {
  if (!window.currentCalendarYear || !window.currentCalendarMonth) {
    const d = new Date();
    window.currentCalendarYear = d.getFullYear();
    window.currentCalendarMonth = d.getMonth() + 1;
  }
  let newMonth = window.currentCalendarMonth + delta;
  let newYear = window.currentCalendarYear;
  if (newMonth < 1) {
    newMonth = 12;
    newYear -= 1;
  } else if (newMonth > 12) {
    newMonth = 1;
    newYear += 1;
  }
  loadIngestionCalendar(newYear, newMonth);
}

function onCalendarMonthSelect(value) {
  if (!value) return;
  const [y, m] = value.split("-").map(Number);
  loadIngestionCalendar(y, m);
}

function jumpCalendarToday() {
  const d = new Date();
  loadIngestionCalendar(d.getFullYear(), d.getMonth() + 1);
}

let pickerViewingYear = null;
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toggleMonthYearPicker(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const pickerEl = document.getElementById("ingestion-month-year-picker");
  const titleBtn = document.getElementById("ingestion-cal-title-btn");
  if (!pickerEl) return;

  const isOpen = pickerEl.style.display === "block" || pickerEl.style.display === "flex";
  if (isOpen) {
    closeMonthYearPicker();
  } else {
    pickerViewingYear = window.currentCalendarYear || (new Date().getFullYear());
    renderPickerMonthsGrid();
    pickerEl.style.display = "flex";
    if (titleBtn) titleBtn.classList.add("picker-open");
  }
}

function closeMonthYearPicker() {
  const pickerEl = document.getElementById("ingestion-month-year-picker");
  const titleBtn = document.getElementById("ingestion-cal-title-btn");
  if (pickerEl) pickerEl.style.display = "none";
  if (titleBtn) titleBtn.classList.remove("picker-open");
}

function pickerChangeYear(delta) {
  if (!pickerViewingYear) {
    pickerViewingYear = window.currentCalendarYear || (new Date().getFullYear());
  }
  pickerViewingYear += delta;
  renderPickerMonthsGrid();
}

function selectMonthFromPicker(monthNum) {
  if (!pickerViewingYear) {
    pickerViewingYear = window.currentCalendarYear || (new Date().getFullYear());
  }
  loadIngestionCalendar(pickerViewingYear, monthNum);
  closeMonthYearPicker();
}

function pickerJumpThisMonth() {
  const now = new Date();
  loadIngestionCalendar(now.getFullYear(), now.getMonth() + 1);
  closeMonthYearPicker();
}

function renderPickerMonthsGrid() {
  const yearLabel = document.getElementById("picker-year-label");
  const gridEl = document.getElementById("picker-months-grid");
  if (!gridEl) return;

  if (!pickerViewingYear) {
    pickerViewingYear = window.currentCalendarYear || (new Date().getFullYear());
  }
  if (yearLabel) yearLabel.textContent = pickerViewingYear;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const activeYear = window.currentCalendarYear;
  const activeMonth = window.currentCalendarMonth;

  const availableMonths = (window.currentCalendarData && window.currentCalendarData.available_months) || [];

  gridEl.innerHTML = MONTH_NAMES_SHORT.map((name, idx) => {
    const mNum = idx + 1;
    const mIso = `${pickerViewingYear}-${String(mNum).padStart(2, '0')}`;
    const isActive = pickerViewingYear === activeYear && mNum === activeMonth;
    const isToday = pickerViewingYear === currentYear && mNum === currentMonth;
    const hasData = availableMonths.includes(mIso);

    let classes = ["picker-month-btn"];
    if (isActive) classes.push("active");
    if (isToday) classes.push("is-today");
    if (hasData) classes.push("has-data");

    return `
      <button type="button" class="${classes.join(' ')}" onclick="selectMonthFromPicker(${mNum})" title="${name} ${pickerViewingYear}${hasData ? ' (has email data)' : ''}">
        ${name}
      </button>
    `;
  }).join("");
}

function renderIngestionCalendar(data) {
  const titleEl = document.getElementById("ingestion-cal-title");
  if (titleEl) titleEl.textContent = data.month_name || `${data.year}-${data.month}`;

  // If picker modal is open, refresh it so active month reflects newly loaded data
  const pickerEl = document.getElementById("ingestion-month-year-picker");
  if (pickerEl && (pickerEl.style.display === "block" || pickerEl.style.display === "flex")) {
    renderPickerMonthsGrid();
  }

  if (!window.selectedAccounts) {
    window.selectedAccounts = new Set();
  }
  const isAll = window.selectedAccounts.size === 0;

  // Render clickable account filter legend chips
  if (data.series) {
    renderAccountFilterLegend(data.series);
  }

  const dailyCounts = data.daily_counts || {};
  const numDays = data.days_in_month;

  // Compute metrics dynamically based on account filter
  let filteredMonthTotal = 0;
  let filteredPeakDate = null;
  let filteredPeakCount = 0;
  let maxCount = 1;

  Object.entries(dailyCounts).forEach(([dStr, d]) => {
    const count = isAll
      ? (d.total || 0)
      : Object.entries(d.by_account || {}).reduce((sum, [accId, cnt]) => {
          return sum + (window.selectedAccounts.has(accId) ? cnt : 0);
        }, 0);
    filteredMonthTotal += count;
    if (count > maxCount) maxCount = count;
    if (count > filteredPeakCount) {
      filteredPeakCount = count;
      filteredPeakDate = dStr;
    }
  });

  const dailyAvg = numDays > 0 ? (filteredMonthTotal / numDays).toFixed(1) : "0.0";

  const totalEl = document.getElementById("cal-stat-month-total");
  const avgEl = document.getElementById("cal-stat-daily-avg");
  const peakEl = document.getElementById("cal-stat-peak-day");
  if (totalEl) totalEl.textContent = `${filteredMonthTotal} emails`;
  if (avgEl) avgEl.textContent = `${dailyAvg} / day`;
  if (peakEl) {
    if (filteredPeakCount > 0 && filteredPeakDate) {
      const d = new Date(filteredPeakDate + "T00:00:00");
      const dStr = d.toLocaleDateString("default", { month: "short", day: "numeric" });
      peakEl.textContent = `${dStr} (${filteredPeakCount})`;
    } else {
      peakEl.textContent = "None";
    }
  }

  const gridEl = document.getElementById("ingestion-calendar-grid");
  if (!gridEl) return;

  const firstWeekday = data.first_weekday;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let html = "";
  for (let i = 0; i < firstWeekday; i++) {
    html += `<div class="ingestion-cal-day empty"></div>`;
  }

  for (let day = 1; day <= numDays; day++) {
    const dStr = `${data.year}-${String(data.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayData = dailyCounts[dStr] || { total: 0, by_account: {} };
    const count = isAll
      ? (dayData.total || 0)
      : Object.entries(dayData.by_account || {}).reduce((sum, [accId, cnt]) => {
          return sum + (window.selectedAccounts.has(accId) ? cnt : 0);
        }, 0);
    const isToday = dStr === todayStr;

    let densityClass = "cal-density-0";
    if (count > 0) {
      const ratio = count / maxCount;
      if (ratio <= 0.25) densityClass = "cal-density-1";
      else if (ratio <= 0.5) densityClass = "cal-density-2";
      else if (ratio <= 0.8) densityClass = "cal-density-3";
      else densityClass = "cal-density-4";
    }

    const hasDataClass = count > 0 ? "has-data" : "";
    const todayClass = isToday ? "today" : "";

    let miniBarHtml = "";
    if (count > 0) {
      let segments = [];
      let accountedCount = 0;
      const activeSeries = isAll
        ? (data.series || [])
        : (data.series || []).filter(s => window.selectedAccounts.has(s.account_id));

      activeSeries.forEach(s => {
        const cnt = (dayData.by_account && dayData.by_account[s.account_id]) || 0;
        if (cnt > 0) {
          accountedCount += cnt;
          const pct = ((cnt / count) * 100).toFixed(1);
          segments.push(`<div class="cal-day-bar-segment" style="width:${pct}%; background:${s.color};"></div>`);
        }
      });
      if (count > accountedCount && isAll) {
        const remainder = count - accountedCount;
        const pct = ((remainder / count) * 100).toFixed(1);
        segments.push(`<div class="cal-day-bar-segment" style="width:${pct}%; background:#94a3b8;"></div>`);
      }
      if (segments.length > 0) {
        miniBarHtml = `<div class="cal-day-bar">${segments.join("")}</div>`;
      }
    }

    html += `
      <div class="ingestion-cal-day ${densityClass} ${hasDataClass} ${todayClass}"
           data-date="${dStr}"
           onclick="toggleCalendarDayPopover(this, event, '${dStr}')"
           onmouseenter="handleDayMouseEnter(this, event, '${dStr}')"
           onmousemove="updateChartPopoverPos(this, event)"
           onmouseleave="handleDayMouseLeave()">
        <span class="ingestion-cal-day-num">${day}</span>
        ${count > 0 ? `<span class="ingestion-cal-day-count">${count}</span>` : ""}
        ${miniBarHtml}
      </div>
    `;
  }

  gridEl.innerHTML = html;
}

function handleDayMouseEnter(cellEl, event, dateStr) {
  if (isRecentTouch()) return;
  cancelHidePopover();
  showCalendarDayPopover(cellEl, event, dateStr);
}

function handleDayMouseLeave() {
  if (isRecentTouch()) return;
  scheduleHidePopover();
}

function showCalendarDayPopover(cellEl, event, dateStr) {
  const popoverEl = document.getElementById("sync-chart-popover");
  const bodyEl = document.getElementById("sync-chart-popover-body");
  if (!popoverEl || !bodyEl || !window.currentCalendarData) return;

  initPopoverHoverListeners();

  activePopoverEl = cellEl;
  activePopoverType = "calendar";
  activePopoverDateStr = dateStr;
  activePopoverDayIdx = null;
  lastPopoverShowTime = Date.now();
  const data = window.currentCalendarData;
  const dayData = (data.daily_counts && data.daily_counts[dateStr]) || { total: 0, by_account: {} };
  const total = dayData.total || 0;
  const byAccount = dayData.by_account || {};

  const isAll = !window.selectedAccounts || window.selectedAccounts.size === 0;
  const displayTotal = isAll
    ? total
    : Object.entries(byAccount).reduce((sum, [accId, cnt]) => {
        return sum + (window.selectedAccounts.has(accId) ? cnt : 0);
      }, 0);

  const d = new Date(dateStr + "T00:00:00");
  const dateFormatted = d.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  let itemsHtml = "";
  if (displayTotal === 0) {
    itemsHtml = `<div style="color:var(--text-dim); font-size:11px; padding:4px 0;">No emails received on this day.</div>`;
  } else {
    itemsHtml = (data.series || []).map(s => {
      const count = byAccount[s.account_id] || 0;
      if (count === 0) return "";
      const isFilteredMatch = !isAll && window.selectedAccounts.has(s.account_id);
      const highlightStyle = isFilteredMatch
        ? `background:${s.color}22; border:1px solid ${s.color}; box-shadow:0 0 6px ${s.color}33;`
        : `background:rgba(255, 255, 255, 0.03); border:1px solid rgba(255, 255, 255, 0.06);`;
      const titleText = isFilteredMatch
        ? `Click to deselect ${escapeHtml(s.account_name)}`
        : (isAll ? `Filter by ${escapeHtml(s.account_name)}` : `Click to add ${escapeHtml(s.account_name)} to filter`);
      return `
        <div class="popover-account-row"
             onclick="onLegendAccountClick('${escapeHtml(s.account_id)}', event)"
             title="${titleText}"
             style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:4px 8px; border-radius:6px; cursor:pointer; transition:all 0.15s ease; ${highlightStyle}">
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span style="width:8px; height:8px; border-radius:50%; background:${s.color}; display:inline-block;"></span>
            <span style="color:var(--text-main); font-size:11px;">${escapeHtml(s.account_name)}</span>
          </span>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <strong style="color:#60a5fa; font-size:11px;">${count} email${count === 1 ? '' : 's'}</strong>
            ${isFilteredMatch ? `<span style="font-size:10px; color:${s.color}; font-weight:700;">✓</span>` : ''}
          </span>
        </div>
      `;
    }).join("");

    if (!itemsHtml) {
      itemsHtml = Object.entries(byAccount).map(([acc, cnt]) => `
        <div class="popover-account-row"
             onclick="onLegendAccountClick('${escapeHtml(acc)}', event)"
             title="Click to filter by ${escapeHtml(acc)}"
             style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:4px 8px; border-radius:6px; cursor:pointer; transition:all 0.15s ease;">
          <span>${escapeHtml(acc)}</span>
          <strong style="color:#60a5fa;">${cnt} email${cnt === 1 ? '' : 's'}</strong>
        </div>
      `).join("");
    }
  }

  // Peak Hour detection (all accounts or specific filtered accounts)
  let peakHour = null;
  if (isAll) {
    peakHour = dayData.peak_hour;
  } else if (dayData.hourly_by_account) {
    const combinedHours = {};
    for (const accId of window.selectedAccounts) {
      const accHours = dayData.hourly_by_account[accId] || {};
      for (const [h, c] of Object.entries(accHours)) {
        combinedHours[h] = (combinedHours[h] || 0) + c;
      }
    }
    let topH = null;
    let topC = 0;
    for (const [h, c] of Object.entries(combinedHours)) {
      if (c > topC) {
        topC = c;
        topH = parseInt(h, 10);
      }
    }
    if (topC > 0 && topH !== null) {
      peakHour = { hour: topH, count: topC };
    }
  }

  let peakBadgeHtml = "";
  if (peakHour && peakHour.count > 0) {
    const startH = String(peakHour.hour).padStart(2, "0") + ":00";
    const endH = String((peakHour.hour + 1) % 24).padStart(2, "0") + ":00";
    peakBadgeHtml = `
      <div style="font-size:10px; color:#fbbf24; margin-top:6px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; gap:5px;">
        <span>⚡ Peak Hour:</span>
        <strong style="color:#fde047;">${startH} – ${endH}</strong>
        <span style="color:var(--text-dim);">(${peakHour.count} email${peakHour.count === 1 ? '' : 's'})</span>
      </div>
    `;
  }

  const labelText = isAll
    ? "Day Total"
    : (window.selectedAccounts && window.selectedAccounts.size > 1 ? `Selected (${window.selectedAccounts.size})` : "Selected Total");

  bodyEl.innerHTML = `
    <div style="font-weight:700; color:var(--text-main); margin-bottom:6px; font-size:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <span>📅 ${escapeHtml(dateFormatted)}</span>
      <span style="font-size:10px; color:var(--text-dim); font-weight:400;">${labelText}: <strong>${displayTotal}</strong></span>
    </div>
    <div style="display:flex; flex-direction:column; gap:2px;">
      ${itemsHtml}
    </div>
    ${peakBadgeHtml}
  `;

  popoverEl.style.display = "block";
  updateChartPopoverPos(cellEl, event);
}

function toggleCalendarDayPopover(cellEl, event, dateStr) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const popoverEl = document.getElementById("sync-chart-popover");
  const isAlreadyOpen = popoverEl && popoverEl.style.display === "block" && activePopoverEl === cellEl;

  // Debounce check: if opened within last 450ms by touch/synthetic event, keep it open!
  if (isAlreadyOpen && (Date.now() - lastPopoverShowTime < 450)) {
    return;
  }

  if (isAlreadyOpen) {
    hideChartPopover();
  } else {
    showCalendarDayPopover(cellEl, event, dateStr);
  }
}


window.currentSyncChartData = null;

function renderSyncChartData(data) {
  const barsEl = document.getElementById("sync-chart-bars-container");
  const labelsEl = document.getElementById("sync-chart-labels-container");
  if (!barsEl || !labelsEl || !data) return;

  const days = data.days || [];
  const series = data.series || [];

  renderAccountFilterLegend(series);

  const isAll = !window.selectedAccounts || window.selectedAccounts.size === 0;

  const dayTotals = days.map((_, dayIdx) => {
    if (isAll) {
      return series.reduce((sum, s) => sum + (s.counts[dayIdx] || 0), 0);
    } else {
      return series.reduce((sum, s) => {
        return sum + (window.selectedAccounts.has(s.account_id) ? (s.counts[dayIdx] || 0) : 0);
      }, 0);
    }
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
      const isFilteredMatch = isAll || window.selectedAccounts.has(s.account_id);
      if (!isFilteredMatch) return "";
      const pct = (total > 0) ? ((val / total) * 100).toFixed(1) : 0;
      return `
        <div class="chart-segment"
             data-acc="${escapeHtml(s.account_name)}"
             style="height:${pct}%; background:${s.color}; width:100%; transition:all 0.2s ease; cursor:pointer;">
        </div>
      `;
    }).join("");

    const heightPct = Math.max(Math.round((total / maxVal) * 100), total > 0 ? 8 : 4);

    return `
      <div class="chart-bar-column"
           style="flex:1; display:flex; flex-direction:column; align-items:center; height:100%; justify-content:flex-end;">
        <span style="font-size:9px; color:var(--text-dim); margin-bottom:2px; opacity:${total > 0 ? '1' : '0.4'}; font-weight:600;">${total}</span>
        <div class="chart-bar-pill"
             onclick="toggleChartPopover(this, event, ${dayIdx})"
             onmouseenter="handleChartMouseEnter(this, event, ${dayIdx})"
             onmousemove="updateChartPopoverPos(this, event)"
             onmouseleave="handleChartMouseLeave(this)"
             style="width:75%; max-width:28px; height:${heightPct}%; background:rgba(255,255,255,0.04); border-radius:4px 4px 0 0; display:flex; flex-direction:column-reverse; overflow:hidden; border:1px solid rgba(255,255,255,0.08); cursor:pointer; transition:all 0.15s ease;">
          ${segmentsHtml}
        </div>
      </div>
    `;
  }).join("");

  labelsEl.innerHTML = days.map(dayLabel => `
    <div style="flex:1;">${escapeHtml(dayLabel)}</div>
  `).join("");
}

function handleChartMouseEnter(pillEl, event, dayIdx) {
  if (isRecentTouch()) return;
  cancelHidePopover();
  pillEl.style.filter = "brightness(1.25)";
  pillEl.style.boxShadow = "0 0 10px rgba(59,130,246,0.4)";
  showChartPopover(pillEl, event, dayIdx);
}

function handleChartMouseLeave(pillEl) {
  if (pillEl) {
    pillEl.style.filter = "none";
    pillEl.style.boxShadow = "none";
  }
  if (isRecentTouch()) return;
  scheduleHidePopover();
}

async function loadSyncChartData() {
  try {
    const tzOffset = new Date().getTimezoneOffset();
    const res = await fetch(`/api/admin/sync-chart-data?tz_offset=${tzOffset}`);
    if (!res.ok) return;
    const data = await res.json();
    window.currentSyncChartData = data;
    renderSyncChartData(data);
  } catch (err) {
    console.error("Error loading sync chart data:", err);
  }
}

function showChartPopover(pillEl, event, dayIdx) {
  const popoverEl = document.getElementById("sync-chart-popover");
  const bodyEl = document.getElementById("sync-chart-popover-body");
  if (!popoverEl || !bodyEl || !window.currentSyncChartData) return;

  initPopoverHoverListeners();

  activePopoverEl = pillEl;
  activePopoverType = "chart";
  activePopoverDayIdx = dayIdx;
  activePopoverDateStr = null;
  lastPopoverShowTime = Date.now();
  const data = window.currentSyncChartData;
  const dayLabel = data.days[dayIdx] || "";
  const series = data.series || [];

  const isAll = !window.selectedAccounts || window.selectedAccounts.size === 0;

  const itemsHtml = series.map(s => {
    const val = s.counts[dayIdx] || 0;
    const isFilteredMatch = !isAll && window.selectedAccounts.has(s.account_id);
    const highlightStyle = isFilteredMatch
      ? `background:${s.color}22; border:1px solid ${s.color}; box-shadow:0 0 6px ${s.color}33;`
      : `background:rgba(255, 255, 255, 0.03); border:1px solid rgba(255, 255, 255, 0.06);`;
    const titleText = isFilteredMatch
      ? `Click to deselect ${escapeHtml(s.account_name)}`
      : (isAll ? `Filter by ${escapeHtml(s.account_name)}` : `Click to add ${escapeHtml(s.account_name)} to filter`);
    return `
      <div class="popover-account-row"
           onclick="onLegendAccountClick('${escapeHtml(s.account_id)}', event)"
           title="${titleText}"
           style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:4px 8px; border-radius:6px; cursor:pointer; transition:all 0.15s ease; ${highlightStyle}">
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span style="width:8px; height:8px; border-radius:50%; background:${s.color}; display:inline-block;"></span>
          <span style="color:var(--text-main); font-size:11px;">${escapeHtml(s.account_name)}</span>
        </span>
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <strong style="color:#60a5fa; font-size:11px;">${val} email${val === 1 ? '' : 's'}</strong>
          ${isFilteredMatch ? `<span style="font-size:10px; color:${s.color}; font-weight:700;">✓</span>` : ''}
        </span>
      </div>
    `;
  }).join("");

  const dayTotal = isAll
    ? series.reduce((sum, s) => sum + (s.counts[dayIdx] || 0), 0)
    : series.reduce((sum, s) => sum + (window.selectedAccounts.has(s.account_id) ? (s.counts[dayIdx] || 0) : 0), 0);

  const labelText = isAll
    ? "Day Total"
    : (window.selectedAccounts && window.selectedAccounts.size > 1 ? `Selected (${window.selectedAccounts.size})` : "Selected Total");

  bodyEl.innerHTML = `
    <div style="font-weight:700; color:var(--text-main); margin-bottom:6px; font-size:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <span>📅 ${escapeHtml(dayLabel)}</span>
      <span style="font-size:10px; color:var(--text-dim); font-weight:400;">${labelText}: <strong>${dayTotal}</strong></span>
    </div>
    <div style="display:flex; flex-direction:column; gap:2px;">
      ${itemsHtml}
    </div>
  `;

  popoverEl.style.display = "block";
  updateChartPopoverPos(pillEl, event);
}

function toggleChartPopover(pillEl, event, dayIdx) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const popoverEl = document.getElementById("sync-chart-popover");
  const isAlreadyOpen = popoverEl && popoverEl.style.display === "block" && activePopoverEl === pillEl;

  // Debounce check: if opened within last 450ms by touch/synthetic event, keep it open!
  if (isAlreadyOpen && (Date.now() - lastPopoverShowTime < 450)) {
    return;
  }

  if (isAlreadyOpen) {
    hideChartPopover();
  } else {
    showChartPopover(pillEl, event, dayIdx);
  }
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

    // Dynamic horizontal alignment of arrow towards target center, even at viewport boundaries
    if (arrowEl) {
      const targetCenterX = pillRect.left + (pillRect.width / 2);
      const arrowOffsetInPopover = targetCenterX - x;
      const minArrowLeft = 14;
      const maxArrowLeft = Math.max(minArrowLeft, popoverRect.width - 14);
      const clampedArrowLeft = Math.max(minArrowLeft, Math.min(arrowOffsetInPopover, maxArrowLeft));

      arrowEl.style.left = `${Math.round(clampedArrowLeft)}px`;
      arrowEl.style.marginLeft = "-4px";
    }

    popoverEl.style.left = `${Math.round(x)}px`;
    popoverEl.style.top = `${Math.round(y)}px`;
  }
}

function hideChartPopover() {
  cancelHidePopover();
  isMouseInPopover = false;
  const popoverEl = document.getElementById("sync-chart-popover");
  if (!popoverEl) return;
  popoverEl.style.display = "none";
  activePopoverEl = null;
  activePopoverType = null;
  activePopoverDateStr = null;
  activePopoverDayIdx = null;
}

// Dismiss popover and month picker when clicking or tapping outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".chart-bar-pill") && !e.target.closest(".ingestion-cal-day") && !e.target.closest("#sync-chart-popover")) {
    hideChartPopover();
  }
  if (!e.target.closest("#ingestion-month-year-picker") && !e.target.closest("#ingestion-cal-title-btn")) {
    closeMonthYearPicker();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideChartPopover();
    closeMonthYearPicker();
  }
});

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
    let data = null;
    try {
      data = await res.json();
    } catch (e) { }

    if (res.ok && data) {
      showToast(`Rule '${data.name}' created successfully!`, "success");
      if (nameInput) nameInput.value = "";
      if (patternInput) patternInput.value = "";
      await loadAutoIgnoreRules();
    } else {
      showToast((data && data.detail) || `Failed to create rule (HTTP ${res.status}).`, "error");
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
  const backupRetentionDays = document.getElementById("admin-backup-retention-days");

  const payload = {
    imap_sync_enabled: imapToggle ? imapToggle.checked : true,
    imap_sync_interval_seconds: imapInterval ? parseInt(imapInterval.value, 10) || 300 : 300,
    ui_auto_refresh_enabled: uiToggle ? uiToggle.checked : true,
    ui_auto_refresh_interval_seconds: uiInterval ? parseInt(uiInterval.value, 10) || 30 : 30,
    auto_purge_synced_enabled: purgeSyncedToggle ? purgeSyncedToggle.checked : false,
    purge_synced_days: purgeSyncedDays ? parseInt(purgeSyncedDays.value, 10) || 30 : 30,
    auto_purge_ignored_enabled: purgeIgnoredToggle ? purgeIgnoredToggle.checked : false,
    purge_ignored_days: purgeIgnoredDays ? parseInt(purgeIgnoredDays.value, 10) || 30 : 30,
    backup_retention_days: backupRetentionDays ? parseInt(backupRetentionDays.value, 10) || 14 : 14
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
      <span style="font-size:11px; color:var(--text-dim); font-family:monospace;">${(parseUtcDate(data.timestamp) || new Date()).toLocaleTimeString()}</span>
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

// Global button initialization & window exposure
function initIngestionViewButtons() {
  const btnChart = document.getElementById("btn-ingestion-view-chart");
  const btnCal = document.getElementById("btn-ingestion-view-calendar");
  if (btnChart && !btnChart._bound) {
    btnChart._bound = true;
    btnChart.addEventListener("click", () => switchIngestionView("chart"));
  }
  if (btnCal && !btnCal._bound) {
    btnCal._bound = true;
    btnCal.addEventListener("click", () => switchIngestionView("calendar"));
  }

  // Mobile swipe gestures for calendar navigation
  const calViewEl = document.getElementById("ingestion-calendar-view");
  if (calViewEl && !calViewEl._swipeBound) {
    calViewEl._swipeBound = true;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeStartTime = 0;

    calViewEl.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches.length === 1) {
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
        swipeStartTime = Date.now();
      }
    }, { passive: true });

    calViewEl.addEventListener("touchend", (e) => {
      if (e.changedTouches && e.changedTouches.length === 1) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = endX - swipeStartX;
        const diffY = endY - swipeStartY;
        const duration = Date.now() - swipeStartTime;

        // Min 45px swipe, fast gesture (< 500ms), predominantly horizontal
        if (duration < 500 && Math.abs(diffX) >= 45 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
          if (diffX < 0) {
            // Swipe Left -> Next month
            navCalendarMonth(1);
          } else {
            // Swipe Right -> Previous month
            navCalendarMonth(-1);
          }
        }
      }
    }, { passive: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initIngestionViewButtons);
} else {
  initIngestionViewButtons();
}

// Explicit global exposure for inline onclick handlers and window access
window.switchIngestionView = switchIngestionView;
window.loadIngestionCalendar = loadIngestionCalendar;
window.renderIngestionCalendar = renderIngestionCalendar;
window.navCalendarMonth = navCalendarMonth;
window.onCalendarMonthSelect = onCalendarMonthSelect;
window.jumpCalendarToday = jumpCalendarToday;
window.showCalendarDayPopover = showCalendarDayPopover;
window.toggleCalendarDayPopover = toggleCalendarDayPopover;
window.showChartPopover = showChartPopover;
window.toggleChartPopover = toggleChartPopover;
window.hideChartPopover = hideChartPopover;
window.updateChartPopoverPos = updateChartPopoverPos;
window.loadSyncChartData = loadSyncChartData;
window.renderSyncChartData = renderSyncChartData;
window.toggleMonthYearPicker = toggleMonthYearPicker;
window.closeMonthYearPicker = closeMonthYearPicker;
window.pickerChangeYear = pickerChangeYear;
window.selectMonthFromPicker = selectMonthFromPicker;
window.pickerJumpThisMonth = pickerJumpThisMonth;
window.renderPickerMonthsGrid = renderPickerMonthsGrid;
window.handleDayMouseEnter = handleDayMouseEnter;
window.handleDayMouseLeave = handleDayMouseLeave;
window.handleChartMouseEnter = handleChartMouseEnter;
window.handleChartMouseLeave = handleChartMouseLeave;
window.onCalendarAccountFilterChange = onCalendarAccountFilterChange;
window.onLegendAccountClick = onLegendAccountClick;
window.renderAccountFilterLegend = renderAccountFilterLegend;
window.triggerManualDbBackup = triggerManualDbBackup;





