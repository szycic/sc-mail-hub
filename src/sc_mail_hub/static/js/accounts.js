/**
 * Email Account Management Controller for SC Mail Hub.
 */

async function loadAccounts() {
  const listEl = document.getElementById("accounts-list");

  try {
    const res = await fetch("/api/accounts");
    const accounts = await res.json();

    const filterAccSelect = document.getElementById("filter-account");
    if (filterAccSelect) {
      const curVal = filterAccSelect.value || "ALL";
      filterAccSelect.innerHTML = `<option value="ALL">All Connected Accounts</option>` +
        accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.email_address)})</option>`).join("");
      filterAccSelect.value = curVal;
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
