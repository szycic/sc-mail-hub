/**
 * SC Mail Hub Application Bootstrap.
 * Initializes tab navigation, loads initial state, and manages auto-refresh.
 */

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  await loadAccounts();
  loadCandidates();
  await loadNotionConfig();
  loadAISettings();

  // Auto-refresh inbox candidates every 30 seconds
  setInterval(() => {
    loadCandidates();
  }, 30000);
});
