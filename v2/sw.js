importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyDSdF3f-vAOxlqh75yNC9MdvDJbEeg_F_c",
  authDomain: "trackio-pro.firebaseapp.com",
  projectId: "trackio-pro",
  storageBucket: "trackio-pro.firebasestorage.app",
  messagingSenderId: "212091683334",
  appId: "1:212091683334:web:4c369422e1df94dbe63987"
};

try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    const notification = payload.notification || {};
    const title = notification.title || data.title || "Trackio PRO";
    self.registration.showNotification(title, {
      body: notification.body || data.body || "You have a revision reminder.",
      icon: "../icon-192.png",
      badge: "../icon-192.png",
      tag: data.tag || "trackio-fcm-" + Date.now(),
      data: { url: data.url || "./" }
    });
  });
} catch (error) {
  console.warn("FCM background messaging initialization failed:", error);
}

const CACHE_NAME = "trackio-pro-v2-shell-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "../icon-192.png?v=4",
  "../icon-512.png?v=4"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client && client.url !== targetUrl) client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
  }
});
