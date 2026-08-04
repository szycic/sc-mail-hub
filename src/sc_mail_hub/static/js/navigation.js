/**
 * Navigation & Tab Routing Controller for SC Mail Hub.
 */

function switchTab(tabName, updateHistory = true) {
  const tabs = document.querySelectorAll(".nav-tab");
  const tabToSelect = Array.from(tabs).find(t => t.getAttribute("data-tab") === tabName) || tabs[0];
  const target = tabToSelect ? tabToSelect.getAttribute("data-tab") : "inbox";

  tabs.forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  if (tabToSelect) tabToSelect.classList.add("active");
  const targetEl = document.getElementById(`tab-${target}`);
  if (targetEl) targetEl.classList.add("active");

  if (updateHistory) {
    const newPath = `/${target}`;
    if (window.location.pathname !== newPath) {
      history.pushState({ tab: target }, "", newPath);
    }
    if (target === "inbox" && typeof updateUrlParams === "function") {
      updateUrlParams();
    }
  }
}

function getTabFromPath() {
  const path = window.location.pathname.replace(/^\//, "").split("/")[0].toLowerCase();
  const validTabs = ["inbox", "notion", "accounts", "ai", "admin"];
  if (validTabs.includes(path)) {
    return path;
  }
  return "inbox";
}

function toggleMobileMenu(forceState) {
  const navTabs = document.getElementById("nav-tabs");
  const backdrop = document.getElementById("nav-drawer-backdrop");
  if (!navTabs || !backdrop) return;

  const isOpen = navTabs.classList.contains("drawer-open");
  const shouldOpen = forceState !== undefined ? forceState : !isOpen;

  if (shouldOpen) {
    navTabs.classList.add("drawer-open");
    backdrop.classList.add("active");
    document.body.style.overflow = "hidden";
  } else {
    navTabs.classList.remove("drawer-open");
    backdrop.classList.remove("active");
    document.body.style.overflow = "";
  }
}

function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      switchTab(target, true);
      toggleMobileMenu(false);
    });
  });

  window.addEventListener("popstate", (e) => {
    const tab = (e.state && e.state.tab) || getTabFromPath();
    switchTab(tab, false);
    toggleMobileMenu(false);
  });

  const initialTab = getTabFromPath();
  switchTab(initialTab, false);
}

