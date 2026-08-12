/**
 * UI Utilities & Formatting Helpers for SC Mail Hub.
 */

function showToast(message, type = "info", persistent = false, isHtml = false, duration = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return null;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  let iconHtml = `<span>ℹ️</span>`;
  if (type === "success") iconHtml = `<span>✅</span>`;
  if (type === "error") iconHtml = `<span>❌</span>`;
  if (type === "loading") iconHtml = `<span class="toast-spin">⏳</span>`;

  toast.innerHTML = `<span class="toast-icon-wrap">${iconHtml}</span> <span class="toast-text-msg">${isHtml ? message : escapeHtml(message)}</span>`;
  container.appendChild(toast);

  toast.update = function (newMessage, newType = type, newIsHtml = isHtml) {
    let newIconHtml = `<span>ℹ️</span>`;
    if (newType === "success") newIconHtml = `<span>✅</span>`;
    if (newType === "error") newIconHtml = `<span>❌</span>`;
    if (newType === "loading") newIconHtml = `<span class="toast-spin">⏳</span>`;
    toast.className = `toast toast-${newType}`;
    const iconWrap = toast.querySelector(".toast-icon-wrap");
    const textMsg = toast.querySelector(".toast-text-msg");
    if (iconWrap) iconWrap.innerHTML = newIconHtml;
    if (textMsg) {
      if (newIsHtml) textMsg.innerHTML = newMessage;
      else textMsg.textContent = newMessage;
    }
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
    }, duration);
  }

  return toast;
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

function formatStandardDisplayDate(dateStr) {
  if (!dateStr || !String(dateStr).trim() || String(dateStr).trim().toLowerCase() === "null" || String(dateStr).trim().toLowerCase() === "none") return "";
  let str = String(dateStr).trim();

  str = str.replace(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*[\, \s]+/i, "");
  str = str.replace(/(\d+)(?:st|nd|rd|th)/gi, "$1");

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-");
    const mIdx = parseInt(m, 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      return `${String(d).padStart(2, "0")} ${months[mIdx]} ${y}`;
    }
  }

  const euroFullMatch = str.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})$/);
  if (euroFullMatch) {
    const day = String(euroFullMatch[1]).padStart(2, "0");
    const mIdx = parseInt(euroFullMatch[2], 10) - 1;
    const year = euroFullMatch[3];
    if (mIdx >= 0 && mIdx < 12) {
      return `${day} ${months[mIdx]} ${year}`;
    }
  }

  const match = str.match(/(\d{1,2})\s*([A-Za-z]+)(?:\s*(\d{4}))?/);
  if (match) {
    const day = String(match[1]).padStart(2, "0");
    const monthRaw = match[2].slice(0, 3);
    const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1).toLowerCase();
    const year = match[3] || new Date().getFullYear();
    return `${day} ${month} ${year}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, "0");
    const mm = months[parsed.getMonth()];
    const yyyy = parsed.getFullYear();
    return `${dd} ${mm} ${yyyy}`;
  }

  return str;
}

function formatDateForPicker(dateStr) {
  if (!dateStr || !String(dateStr).trim() || String(dateStr).trim().toLowerCase() === "null" || String(dateStr).trim().toLowerCase() === "none") return "";
  const str = String(dateStr).trim();

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // European DD/MM/YYYY or DD.MM.YYYY (e.g. 04/08/2026 -> 2026-08-04)
  const euroFullMatch = str.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})$/);
  if (euroFullMatch) {
    const day = String(euroFullMatch[1]).padStart(2, "0");
    const month = String(euroFullMatch[2]).padStart(2, "0");
    const year = euroFullMatch[3];
    return `${year}-${month}-${day}`;
  }

  // European DD/MM or DD.MM (e.g. 04/08 -> 2026-08-04)
  const euroShortMatch = str.match(/^(\d{1,2})[\/\.\-](\d{1,2})$/);
  if (euroShortMatch) {
    const day = String(euroShortMatch[1]).padStart(2, "0");
    const month = String(euroShortMatch[2]).padStart(2, "0");
    const year = new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }

  // Named months e.g. "4 Aug 2026", "12 August"
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const namedMatch = str.match(/(\d{1,2})\s*([A-Za-z]+)(?:\s*(\d{4}))?/);
  if (namedMatch) {
    const day = String(namedMatch[1]).padStart(2, "0");
    const mStr = namedMatch[2].slice(0, 3).toLowerCase();
    const mIdx = monthNames.indexOf(mStr);
    if (mIdx !== -1) {
      const month = String(mIdx + 1).padStart(2, "0");
      const year = namedMatch[3] || new Date().getFullYear();
      return `${year}-${month}-${day}`;
    }
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function formatTimeAgo(dateInput) {
  if (!dateInput) return "Never";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);

  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDateTime(dateInput) {
  if (!dateInput) return "";
  const str = String(dateInput).trim();
  if (!str || str.toLowerCase() === "null" || str.toLowerCase() === "none") return "";

  if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{2}:\d{2}$/.test(str)) {
    return str;
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return str;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(d.getDate()).padStart(2, "0");
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");

  return `${day} ${month} ${year}, ${hours}:${mins}`;
}
