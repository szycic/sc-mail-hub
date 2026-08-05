/**
 * Notification management module for SC Mail Hub.
 *
 * Handles Service Worker registration, permission requests,
 * Web Push subscription (enabling closed-app notifications via VAPID),
 * native app icon badging, and notification dispatching.
 */

let previousPendingCount = null;
let swRegistration = null;

/**
 * Converts a URL-safe Base64 string to a Uint8Array required by pushManager.subscribe.
 *
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribes the current browser/device to Web Push API notifications via backend VAPID public key.
 *
 * @param {ServiceWorkerRegistration} reg
 */
async function subscribeUserToPush(reg) {
  if (!reg || !("pushManager" in reg)) {
    console.warn("Push messaging is not supported in this browser environment.");
    return;
  }

  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  try {
    // Fetch current active VAPID public key from backend
    const response = await fetch("/api/notifications/vapid-public-key");
    if (!response.ok) {
      throw new Error("Failed to fetch VAPID public key");
    }
    const data = await response.json();
    const serverKeyUint8 = urlBase64ToUint8Array(data.public_key);

    let subscription = await reg.pushManager.getSubscription();

    // Verify if existing subscription matches current VAPID key
    if (subscription && subscription.options && subscription.options.applicationServerKey) {
      const existingKeyUint8 = new Uint8Array(subscription.options.applicationServerKey);
      let isMatch = existingKeyUint8.length === serverKeyUint8.length;
      if (isMatch) {
        for (let i = 0; i < serverKeyUint8.length; i++) {
          if (existingKeyUint8[i] !== serverKeyUint8[i]) {
            isMatch = false;
            break;
          }
        }
      }

      if (!isMatch) {
        console.log("VAPID key mismatch detected. Unsubscribing stale subscription...");
        await subscription.unsubscribe();
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: serverKeyUint8
      });
    }

    // Register subscription endpoint and keys with backend database
    const subJson = subscription.toJSON();
    await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth
        }
      })
    });

    console.log("Web Push subscription active for closed-app notifications.");
  } catch (err) {
    console.warn("Failed to subscribe device to Web Push:", err);
  }
}

// Initialize Service Worker and request notification permissions
function initNotifications() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => navigator.serviceWorker.register("/static/js/sw.js"))
      .then((reg) => {
        swRegistration = reg;
        reg.update().catch(() => {});
        if (Notification.permission === "granted") {
          subscribeUserToPush(reg);
        }
      })
      .catch((err) => {
        console.warn("ServiceWorker registration failed:", err);
      });
  }

  // Request notification permission automatically on first user click if state is default
  if ("Notification" in window && Notification.permission === "default") {
    const requestPerm = () => {
      Notification.requestPermission()
        .then((perm) => {
          if (perm === "granted" && swRegistration) {
            subscribeUserToPush(swRegistration);
          }
        })
        .catch(() => {});
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

    // Desktop Browser Notification (when open)
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
