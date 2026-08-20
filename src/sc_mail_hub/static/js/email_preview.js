/**
 * Email Message Preview Modal & PDF Downloader for SC Mail Hub.
 */

async function previewEmail(candidateId) {
  showToast("Loading email message preview...", "info");
  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/email`);
    if (!res.ok) throw new Error("Failed to load email preview");

    const data = await res.json();
    const subjEl = document.getElementById("modal-email-subject");
    const senderEl = document.getElementById("modal-email-sender");
    const dateEl = document.getElementById("modal-email-date");
    const bodyEl = document.getElementById("modal-email-body");

    if (subjEl) subjEl.textContent = data.subject || "No Subject";
    if (senderEl) senderEl.textContent = data.sender || "Unknown Sender";
    if (dateEl) dateEl.textContent = data.received_at ? formatDateTime(data.received_at) : "";
    if (bodyEl) bodyEl.textContent = data.body_text || "No email body text available.";

    const modal = document.getElementById("email-preview-modal");
    if (modal) modal.classList.add("active");
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function closeEmailPreviewModal(e) {
  if (e && e.target && e.target !== e.currentTarget) return;
  const modal = document.getElementById("email-preview-modal");
  if (modal) modal.classList.remove("active");
}
