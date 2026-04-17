// Scripts for firebase and firebase-messaging
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in the messagingSenderId.
// These values are extracted from the project's .env file.
firebase.initializeApp({
  apiKey: "AIzaSyCT7OzTUXcB_oNfDQ1KO35tDtjeFDFa_ao",
  authDomain: "chess-tournament-software.firebaseapp.com",
  projectId: "chess-tournament-software",
  storageBucket: "chess-tournament-software.firebasestorage.app",
  messagingSenderId: "799885938023",
  appId: "1:799885938023:web:71533630ffefbeece933c2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  // Customize notification here
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
