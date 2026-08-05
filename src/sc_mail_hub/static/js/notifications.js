/**
 * Notification management module for SC Mail Hub.
 *
 * Handles Service Worker registration, permission requests,
 * desktop notifications when pending count increases,
 * persistent PWA notifications on mobile when pending count > 0,
 * and native app icon badging via setAppBadge.
 */

let previousPendingCount = null;
let swRegistration = null;

// Initialize Service Worker and register notification listeners
function initNotifications() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        swRegistration = reg;
      })
      .catch((err) => {
        console.warn("ServiceWorker registration failed:", err);
      });
  }

  // Request permission automatically if default (user can also grant via prompt)
  if ("Notification" in window && Notification.permission === "default") {
    const requestPerm = () => {
      Notification.requestPermission();
      document.removeEventListener("click", requestPerm);
    };
    document.addEventListener("click", requestPerm, { once: true });
  }
}

// Platform detection helper
function isMobileDevice() {
  const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isTouchMobile = window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 1024px)").matches;
  const isStandalonePWA = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  return userAgentMobile || (isTouchMobile && isStandalonePWA) || (isTouchMobile && screen.width <= 768);
}

// Update Native PWA / App Icon Badge
function updateAppBadge(pendingCount) {
  if ("setAppBadge" in navigator) {
    if (pendingCount > 0) {
      navigator.setAppBadge(pendingCount).catch((err) => {
        console.warn("Could not set app badge:", err);
      });
    } else if ("clearAppBadge" in navigator) {
      navigator.clearAppBadge().catch((err) => {
        console.warn("Could not clear app badge:", err);
      });
    }
  }
}

// Request Notification permission explicitly if needed
async function requestNotificationPermission() {
  if ("Notification" in window) {
    const perm = await Notification.requestPermission();
    return perm === "granted";
  }
  return false;
}

// Send Desktop Notification when pending email count increases
function sendDesktopNotification(pendingCount) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const title = "Pending Emails";
  const bodyText = pendingCount === 1 ? "There is 1 pending email." : `There are ${pendingCount} pending emails.`;
  const options = {
    body: bodyText,
    icon: "/static/assets/android-chrome-192x192.png",
    badge: "/static/assets/favicon-32x32.png",
    tag: "desktop-pending-notification",
    renotify: true,
    data: { url: "/inbox" }
  };

  const triggerShow = (reg) => {
    if (reg && reg.showNotification) {
      reg.showNotification(title, options);
    } else {
      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  };

  if (swRegistration) {
    triggerShow(swRegistration);
  } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(triggerShow);
  } else {
    triggerShow(null);
  }
}

// Maintain or dismiss persistent notification on Mobile (PWA)
function updateMobilePWANotification(pendingCount) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const tag = "pending-emails-pwa";

  if (pendingCount > 0) {
    const title = "Pending Emails";
    const bodyText = pendingCount === 1 ? "There is 1 pending email." : `There are ${pendingCount} pending emails.`;
    const options = {
      body: bodyText,
      icon: "/static/assets/android-chrome-192x192.png",
      badge: "/static/assets/favicon-32x32.png",
      tag: tag,
      requireInteraction: true,
      renotify: true,
      data: { url: "/inbox" }
    };

    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, options);
    } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, options);
      });
    } else {
      new Notification(title, options);
    }
  } else {
    // pendingCount === 0: Close persistent notification
    if (swRegistration && swRegistration.getNotifications) {
      swRegistration.getNotifications({ tag }).then((notifications) => {
        notifications.forEach((n) => n.close());
      });
    } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.getNotifications({ tag }).then((notifications) => {
          notifications.forEach((n) => n.close());
        });
      });
    }
  }
}

/**
 * Update notifications according to platform rules:
 * - App Badge: Native app icon badge updated (set / clear).
 * - Desktop: Notify ONLY when pending count INCREASES.
 * - Mobile (PWA): Persistent notification if pendingCount > 0, closed when 0.
 *
 * @param {number} pendingCount - Current number of pending emails
 */
function updatePendingNotifications(pendingCount) {
  if (typeof pendingCount !== "number" || isNaN(pendingCount)) return;

  // Update native PWA icon badge
  updateAppBadge(pendingCount);

  const isMobile = isMobileDevice();

  if (isMobile) {
    updateMobilePWANotification(pendingCount);
  } else {
    if (previousPendingCount !== null && pendingCount > previousPendingCount) {
      sendDesktopNotification(pendingCount);
    }
  }

  previousPendingCount = pendingCount;
}

// Auto-initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNotifications);
} else {
  initNotifications();
}
