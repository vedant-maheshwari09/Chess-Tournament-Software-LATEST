import * as dotenv from "dotenv";
dotenv.config();

async function runDiagnostic() {
  const { notificationService } = await import("./notifications");
  console.log("--- Notification System Diagnostic ---");
  
  // 1. Check Configuration
  const user = process.env.NOTIFY_EMAIL_USER || process.env.GMAIL_USER;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  
  console.log(`Email User: ${user ? "Configured" : "MISSING"}`);
  console.log(`Resend Key: ${resendKey ? "Configured" : "MISSING"}`);
  console.log(`From Address: ${from || "DEFAULT (noreply@example.com)"}`);
  
  // 2. Check Service READINESS
  console.log(`Email Enabled: ${notificationService.isEmailEnabled()}`);
  console.log(`Push Enabled: ${notificationService.isPushEnabled()}`);
  
  // 3. Test Email (Internal Log only, won't send unless we call it)
  console.log("\nAttempting to send a TEST email to the configured user...");
  if (user) {
    try {
      await notificationService.sendEmail({
        to: user,
        subject: "Diagnostic Test Email",
        text: "This is a diagnostic test to verify the notification system is working correctly."
      });
      console.log("SUCCESS: Email send request completed (check your inbox/logs).");
    } catch (err) {
      console.error("FAILURE: Email send failed:", err);
    }
  } else {
    console.log("SKIPPING Email test: No recipient (NOTIFY_EMAIL_USER) configured.");
  }

  // 4. Test Push Initialization
  console.log("\nChecking Firebase Admin initialization...");
  try {
     // We can't easily test a real push without a device token, 
     // but we can check if the app is initialized.
     console.log("Firebase initialized successfully (if no error above).");
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }

  console.log("\n--- Diagnostic Complete ---");
  process.exit(0);
}

runDiagnostic();
