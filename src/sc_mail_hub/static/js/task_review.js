/**
 * Task Review Modal Controller & Link Highlighting Logic for SC Mail Hub.
 */

let currentReviewRawEmailText = "";

async function openTaskReviewModal(candidateId, allowFallback = false) {
  const card = document.getElementById(`candidate-card-${candidateId}`);
  if (card) card.style.opacity = "0.6";

  const candidate = currentCandidates.find(c => c.id === candidateId);

  // If candidate was already AI processed or created, open modal immediately with existing data!
  if (candidate && (candidate.status === "AI_PROCESSED" || candidate.status === "CREATED")) {
    fillTaskReviewForm(candidate);
    if (card) card.style.opacity = "1";
    const modal = document.getElementById("task-review-modal");
    if (modal) modal.classList.add("active");
    return;
  }

  showToast("Running AI extraction for task details...", "info");

  try {
    const url = `/api/inbox/candidates/${candidateId}/prepare-task${allowFallback ? '?allow_fallback=true' : ''}`;
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();

    if (res.ok) {
      fillTaskReviewForm(data);
      loadCandidates();
      const modal = document.getElementById("task-review-modal");
      if (modal) modal.classList.add("active");
      if (card) card.style.opacity = "1";
    } else {
      if (card) card.style.opacity = "1";
      if (!allowFallback && data.detail && (data.detail.includes("AI Provider") || data.detail.includes("OpenAI") || data.detail.includes("Gemini") || data.detail.includes("Groq"))) {
        if (typeof handleAiProviderError === "function") {
          handleAiProviderError(data.detail, () => openTaskReviewModal(candidateId, true));
        } else {
          showToast(data.detail, "error");
        }
      } else {
        showToast(data.detail || "Failed to prepare task", "error");
      }
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
    if (card) card.style.opacity = "1";
  }
}

function updatePriorityDropdownInModal(candidate) {
  const prioritySelect = document.getElementById("review-priority");
  if (!prioritySelect) return;

  const priorityMapping = currentFieldMappings.find(m => m.task_field === "priority");
  let options = [];

  if (priorityMapping && priorityMapping.notion_property_name) {
    const matchedProp = fetchedNotionProperties.find(p => p.name === priorityMapping.notion_property_name);
    if (matchedProp && matchedProp.options && matchedProp.options.length > 0) {
      options = [...matchedProp.options];
    }

    if (priorityMapping.value_mappings_json) {
      try {
        const valMapObj = JSON.parse(priorityMapping.value_mappings_json);
        if (typeof valMapObj === "object") {
          Object.values(valMapObj).forEach(val => {
            if (val && !options.includes(val)) {
              options.push(val);
            }
          });
        }
      } catch (e) { }
    }
  }

  if (options.length === 0) {
    options = ["HIGH", "MEDIUM", "LOW"];
  }

  prioritySelect.innerHTML = options.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("");

  let targetVal = candidate.priority || "MEDIUM";
  if (priorityMapping && priorityMapping.value_mappings_json) {
    try {
      const valMapObj = JSON.parse(priorityMapping.value_mappings_json);
      if (valMapObj[targetVal]) {
        targetVal = valMapObj[targetVal];
      }
    } catch (e) { }
  }

  // Case-insensitive match against allowed Notion schema options
  let matchedOption = options.find(opt => opt.toLowerCase() === targetVal.toLowerCase());

  if (matchedOption) {
    prioritySelect.value = matchedOption;
  } else {
    // Fallback to Medium or Normal before resorting to first option
    let defaultMatch = options.find(opt => opt.toLowerCase() === "medium" || opt.toLowerCase() === "normal") || options[0];
    if (defaultMatch) {
      prioritySelect.value = defaultMatch;
    }
  }
}

function updateEmailBodyLinkHighlight() {
  const bodyEl = document.getElementById("review-email-body");
  const urlInput = document.getElementById("review-url");
  if (!bodyEl) return;

  const targetUrl = (urlInput?.value || "").trim();
  bodyEl.innerHTML = highlightExactTargetLink(currentReviewRawEmailText, targetUrl);
}

function highlightExactTargetLink(text, targetUrl) {
  if (!text) return "";

  let targetClean = (targetUrl || "").trim().toLowerCase();
  if (targetClean.endsWith('/')) targetClean = targetClean.slice(0, -1);

  const safeText = escapeHtml(text);
  const urlRegex = /((?:https?:\/\/|www\.)[^\s<>\"'\(\)]+)/gi;

  return safeText.replace(urlRegex, (matchedUrl) => {
    let rawUrl = matchedUrl
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");

    let cleanUrl = rawUrl.replace(/[\.\,\;\)]+$/, '').toLowerCase();
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);

    let matchUrlLower = rawUrl.toLowerCase();
    if (matchUrlLower.endsWith('/')) matchUrlLower = matchUrlLower.slice(0, -1);

    const hrefUrl = matchedUrl.startsWith('www.') ? `https://${matchedUrl}` : matchedUrl;

    const isTarget = targetClean.length > 0 && (
      cleanUrl === targetClean ||
      matchUrlLower === targetClean ||
      (cleanUrl.length > 10 && targetClean.includes(cleanUrl)) ||
      (targetClean.length > 10 && cleanUrl.includes(targetClean))
    );

    if (isTarget) {
      return `<mark class="target-link-highlight"><a href="${hrefUrl}" target="_blank">${matchedUrl}</a></mark>`;
    }
    return `<a href="${hrefUrl}" target="_blank" class="email-link">${matchedUrl}</a>`;
  });
}

async function fillTaskReviewForm(candidate) {
  const idInput = document.getElementById("review-candidate-id");
  const titleInput = document.getElementById("review-title");
  const summaryInput = document.getElementById("review-summary");
  const urlInput = document.getElementById("review-url");
  const startDateInput = document.getElementById("review-start-date");
  const deadlineInput = document.getElementById("review-deadline");

  if (idInput) idInput.value = String(candidate.id);
  if (titleInput) titleInput.value = candidate.title || "";
  if (summaryInput) summaryInput.value = candidate.summary || "";
  if (urlInput) urlInput.value = candidate.source_url || "";
  if (startDateInput) startDateInput.value = formatDateForPicker(candidate.start_date);
  if (deadlineInput) deadlineInput.value = formatDateForPicker(candidate.deadline);

  updatePriorityDropdownInModal(candidate);
  switchReviewModalTab('form');


  clearReviewTitleError();
  setTaskReviewFormSubmittingState(false);

  // Populate Right Column: Original Email Reference with Link Highlighting
  const senderEl = document.getElementById("review-email-sender");
  const recipientEl = document.getElementById("review-email-recipient");
  const subjectEl = document.getElementById("review-email-subject");
  const dateEl = document.getElementById("review-email-received");
  const updatedEl = document.getElementById("review-candidate-updated");
  const bodyEl = document.getElementById("review-email-body");

  if (senderEl) senderEl.textContent = candidate.sender || "Unknown Sender";
  if (recipientEl) recipientEl.textContent = candidate.recipient || "Me";
  if (subjectEl) subjectEl.textContent = candidate.subject || candidate.title || "No Subject";
  if (dateEl) dateEl.textContent = candidate.received_at || "";
  if (updatedEl) {
    const rawVal = candidate.updated_at || candidate.created_at;
    updatedEl.textContent = rawVal ? formatDateTime(rawVal) : "N/A";
  }

  if (bodyEl) {
    bodyEl.innerHTML = '<div style="color:var(--text-dim);">⏳ Loading original email text...</div>';
    try {
      const emailRes = await fetch(`/api/inbox/candidates/${candidate.id}/email`);
      if (emailRes.ok) {
        const emailData = await emailRes.json();
        currentReviewRawEmailText = emailData.body_text || candidate.summary || "";
      } else {
        currentReviewRawEmailText = candidate.summary || "";
      }
    } catch (e) {
      currentReviewRawEmailText = candidate.summary || "";
    }

    // Auto-extract link if input is empty
    if (urlInput && !urlInput.value.trim() && currentReviewRawEmailText) {
      const linkMatch = currentReviewRawEmailText.match(/https?:\/\/[^\s<>\"'\(\)]+/i);
      if (linkMatch) {
        urlInput.value = linkMatch[0].replace(/[\.\,\;\)]+$/, '');
      }
    }

    updateEmailBodyLinkHighlight();
  }
}

function switchReviewModalTab(tab) {
  const formPane = document.getElementById("review-form-pane");
  const emailPane = document.getElementById("review-email-pane");
  const btnForm = document.getElementById("btn-review-tab-form");
  const btnEmail = document.getElementById("btn-review-tab-email");

  if (!formPane || !emailPane) return;

  if (tab === "email") {
    formPane.classList.add("mobile-hidden");
    emailPane.classList.remove("mobile-hidden");
    if (btnForm) btnForm.classList.remove("active");
    if (btnEmail) btnEmail.classList.add("active");
  } else {
    formPane.classList.remove("mobile-hidden");
    emailPane.classList.add("mobile-hidden");
    if (btnForm) btnForm.classList.add("active");
    if (btnEmail) btnEmail.classList.remove("active");
  }
}

let isTaskReviewSubmitting = false;

function setTaskReviewFormSubmittingState(isSubmitting) {
  isTaskReviewSubmitting = isSubmitting;

  const confirmBtn = document.getElementById("review-confirm-btn");
  const cancelBtn = document.getElementById("review-cancel-btn");
  const closeBtn = document.getElementById("review-modal-close-btn");

  const formFields = [
    document.getElementById("review-title"),
    document.getElementById("review-priority"),
    document.getElementById("review-start-date"),
    document.getElementById("review-deadline"),
    document.getElementById("review-summary"),
    document.getElementById("review-url")
  ];

  formFields.forEach(field => {
    if (field) field.disabled = isSubmitting;
  });

  if (cancelBtn) cancelBtn.disabled = isSubmitting;
  if (closeBtn) closeBtn.disabled = isSubmitting;

  if (confirmBtn) {
    confirmBtn.disabled = isSubmitting;
    if (isSubmitting) {
      confirmBtn.innerHTML = '<span class="btn-spinner"></span>Creating task...';
    } else {
      confirmBtn.innerHTML = "Confirm";
    }
  }
}

function clearReviewTitleError() {
  const titleInput = document.getElementById("review-title");
  const titleError = document.getElementById("review-title-error");
  if (titleInput) titleInput.style.borderColor = "";
  if (titleError) titleError.style.display = "none";
}

function closeTaskReviewModal(e) {
  if (isTaskReviewSubmitting) return;
  if (e && e.target && e.target !== e.currentTarget) return;
  const modal = document.getElementById("task-review-modal");
  if (modal) modal.classList.remove("active");
  clearReviewTitleError();
  setTaskReviewFormSubmittingState(false);
}


async function submitReviewedTaskToNotion() {
  if (isTaskReviewSubmitting) return;

  const candidateId = Number(document.getElementById("review-candidate-id")?.value || 0);
  if (!candidateId) {
    showToast("Missing candidate id", "error");
    return;
  }

  const titleInput = document.getElementById("review-title");
  const titleError = document.getElementById("review-title-error");
  const title = (titleInput?.value || "").trim();
  if (!title) {
    if (titleInput) {
      titleInput.style.borderColor = "#ef4444";
      titleInput.focus();
    }
    if (titleError) {
      titleError.style.display = "block";
    }
    return;
  }
  clearReviewTitleError();

  setTaskReviewFormSubmittingState(true);

  const payload = {
    title: title,
    summary: document.getElementById("review-summary")?.value || "",
    source_url: document.getElementById("review-url")?.value || null,
    priority: document.getElementById("review-priority")?.value || "MEDIUM",
    start_date: document.getElementById("review-start-date")?.value || null,
    deadline: document.getElementById("review-deadline")?.value || null
  };

  try {
    const res = await fetch(`/api/inbox/candidates/${candidateId}/create-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.notion_url) {
      setTaskReviewFormSubmittingState(false);
      closeTaskReviewModal();
      showToast("Task successfully created in Notion!", "success");
      loadCandidates();
    } else {
      showToast(data.detail || "Failed to create task in Notion", "error");
      setTaskReviewFormSubmittingState(false);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
    setTaskReviewFormSubmittingState(false);
  }
}

// Global shortcut listener for Ctrl+Enter / Cmd+Enter inside Task Review modal
document.addEventListener("keydown", function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    const modal = document.getElementById("task-review-modal");
    if (modal && modal.classList.contains("active")) {
      e.preventDefault();
      submitReviewedTaskToNotion();
    }
  }
});
