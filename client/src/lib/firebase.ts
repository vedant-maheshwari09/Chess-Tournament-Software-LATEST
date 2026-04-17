import { initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported } from "firebase/messaging";

const firebaseConfig = {
  // Use Vite env variables. You'll need to provide these in your environment
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let messagingInstance: any = null;
let initPromise: Promise<void> | null = null;

const initMessaging = async () => {
  if (messagingInstance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (firebaseConfig.apiKey) {
        const app = initializeApp(firebaseConfig);
        const supported = await isSupported();
        if (supported) {
          messagingInstance = getMessaging(app);
        } else {
          console.warn("Firebase Messaging is not supported in this browser environment.");
        }
      } else {
        console.warn("Firebase API Key missing. Push notifications will be disabled.");
      }
    } catch (e) {
      console.error("Firebase initialization failed:", e);
    }
  })();

  return initPromise;
};

export const requestFirebaseToken = async () => {
  await initMessaging();
  
  if (!messagingInstance) {
    console.error("Messaging instance not available (browser may not support it or init failed).");
    return null;
  }
  
  try {
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.error("VITE_FIREBASE_VAPID_KEY is missing from environment.");
      return null;
    }
    
    console.log(`Attempting to get FCM token with VAPID key starting with: ${vapidKey.substring(0, 5)}...`);

    const currentToken = await getToken(messagingInstance, { vapidKey });
    
    if (currentToken) {
      return currentToken;
    } else {
      console.warn("No FCM token returned. Permission might be needed.");
      return null;
    }
  } catch (err) {
    console.error('An error occurred while retrieving FCM token:', err);
    throw err; // Throw so we can catch the specific error message in the UI
  }
};

export const getMessagingInstance = async () => {
  await initMessaging();
  return messagingInstance;
};
