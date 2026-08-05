/**
 * Notification management module for SC Mail Hub.
 *
 * Handles Service Worker registration, permission requests,
 * notifications when pending count increases and is non-zero,
 * native app icon badging, and in-app toasts.
 */

let previousPendingCount = null;
let swRegistration = null;

// Initialize Service Worker and request notification permissions
function initNotifications() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => navigator.serviceWorker.register("/static/js/sw.js"))
      .then((reg) => {
        swRegistration = reg;
      })
      .catch((err) => {
        console.warn("ServiceWorker registration failed:", err);
      });
  }

  // Request notification permission automatically on first user click if state is default
  if ("Notification" in window && Notification.permission === "default") {
    const requestPerm = () => {
      Notification.requestPermission().catch(() => {});
    };
    document.addEventListener("click", requestPerm, { once: true });
  }
}

/**
 * Formats the notification text according to the pending count:
 * - 1: "There is 1 pending email"
 * - >1: "There are X pending emails"
 *
 * @param {number} count
 * @returns {string}
 */
function formatPendingNotificationMessage(count) {
  const isSingular = count === 1;
  const verb = isSingular ? "is" : "are";
  const noun = isSingular ? "email" : "emails";
  return `There ${verb} ${count} pending ${noun}`;
}

/**
 * Triggered whenever pending count is updated.
 * Sends a notification when pending count increases and is non-zero (count > 0).
 *
 * @param {number} pendingCount
 */
function handlePendingNotifications(pendingCount) {
  const count = parseInt(pendingCount, 10) || 0;

  // Update App Icon Badge if supported
  if ("setAppBadge" in navigator) {
    if (count > 0) {
      navigator.setAppBadge(count).catch(() => {});
    } else if ("clearAppBadge" in navigator) {
      navigator.clearAppBadge().catch(() => {});
    }
  }

  if (previousPendingCount === null) {
    // Initial baseline on page load
    previousPendingCount = count;
    return;
  }

  // Check if count increased and is non-zero
  if (count > previousPendingCount && count > 0) {
    const message = formatPendingNotificationMessage(count);
    const title = "Mail Hub";

    // Desktop Browser Notification
    if ("Notification" in window && Notification.permission === "granted") {
      const options = {
        body: message,
        icon: "/static/assets/favicon-32x32.png",
        badge: "/static/assets/favicon-16x16.png",
        tag: "pending-emails-notification",
        renotify: true
      };

      if (swRegistration && swRegistration.showNotification) {
        swRegistration.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
    }
  }

  previousPendingCount = count;
}

// Auto-initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initNotifications();
});
