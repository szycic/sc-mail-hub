/**
 * SC Mail Hub Application Bootstrap.
 * Initializes tab navigation, loads initial state, and manages auto-refresh.
 */

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initInboxStateFromUrl();
  await loadAccounts();
  loadCandidates();
  await loadNotionConfig();
  loadAISettings();
  await loadAdminSettings();
});
