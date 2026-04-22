import { registerSchema, loginSchema, changePasswordSchema, verifyEmailSchema, resendVerificationSchema, forgotPasswordSchema, forgotUsernameSchema, resetPasswordSchema } from '@shared/schema';
import { AccountPaymentSettings } from '@shared/tournament-config';
import { hashPassword, verifyPassword, createSession } from '../auth';
import { sendEmailVerificationCode, sendPasswordResetCode } from '../emailVerification';
import type { Express } from "express";
import { z } from "zod";
import Stripe from "stripe";
import {
  lookupUSCF, lookupFide, mapLocalResult, extractQueryParam, normalizeSearchParams, parseLimitParam, getGeminiConfig, normalizeCurrency, computePaymentTotals, normalizeAccountPaymentSettings, formatCurrencyAmount, describeRatingWindow, generatePairings, groupPlayersByScore, pairUpperVsLowerHalf, determineSwissColors, generateSwissPairings, generateBoardNumberSequence, RatingSource, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, stripe, PAYMENT_STATUSES, PaymentStatus, RatingLookupResult, paymentProviderEnum, paymentScopeEnum, offlineMethodEnum, updateTournamentPaymentsSchema, accountPaymentSettingsSchema, geminiDraftSchema, updateNotificationPreferencesSchema, tournamentNotificationSchema, createPaymentIntentSchema, playerRegistrationSchema, BoardNumberingSettings
} from "./common";

import { storage } from '../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../auth';
import { notificationService } from '../notifications';
import { parseTournamentConfig } from "@shared/tournament-config";
import { generateFideTrf16Report } from '../lib/fideTrf';
import { lookupFideProfiles, searchFideDirectory } from '../lib/fideDirectory';
import { Player, Pairing, Match, PlayerRegistration } from "@shared/schema";


export function applyAuthRoutes(app: Express) {
  // Developer bypass route - ONLY FOR TESTING
  app.post("/api/auth/bypass", async (req, res) => {
    try {
      const user = await storage.getUserById(10); // ID 10 is 'mommies'
      if (!user) {
        return res.status(404).json({ message: "Bypass user not found" });
      }
      const session = await createSession(user.id);
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.json({
        user: userWithoutPassword,
        token: session.token
      });
    } catch (error) {
      console.error('Bypass login error:', error);
      res.status(500).json({ message: "Bypass login failed" });
    }
  });

// Authentication routes
app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = registerSchema.parse(req.body);
      const sanitizedPhone = userData.phoneNumber ? userData.phoneNumber.replace(/[^0-9]/g, "") : null;

      // Check if username already exists
      const existingUsername = await storage.getUserByUsername(userData.username);
      if (existingUsername) {
        return res.status(400).json({
          message: "This username is already taken. Please choose a different username."
        });
      }

      // Check if email already exists
      const existingEmail = await storage.getUserByEmail(userData.email);
      if (existingEmail) {
        return res.status(400).json({
          message: "An account with this email already exists. Please use a different email or try logging in."
        });
      }

      // Hash password and create user (email not verified initially)
      const passwordHash = await hashPassword(userData.password);
      const newUser = await storage.createUser({
        username: userData.username,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role,
        passwordHash,
        phoneNumber: sanitizedPhone ?? undefined,
        notifyEmail: userData.notifyEmail ?? true,
        notifyPairings: userData.notifyPairings ?? true,
        notifyRegistration: userData.notifyRegistration ?? true,
        notifyTournamentStatus: userData.notifyTournamentStatus ?? true,
        emailVerified: false,
      });

      // Send verification code (don't create session yet)
      try {
        await sendEmailVerificationCode(newUser.id, userData.email, userData.firstName);
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        // User is created, but email failed - they can request a resend
      }

      // Return user info without token (email not verified)
      const { passwordHash: _, ...userWithoutPassword } = newUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Account created! Please check your email for a verification code.",
        requiresVerification: true
      });
    } catch (error) {
      console.error('Registration error:', error);

      // Handle database constraint violations
      if (error instanceof Error && error.message.includes('unique constraint')) {
        if (error.message.includes('username')) {
          return res.status(400).json({
            message: "This username is already taken. Please choose a different username."
          });
        } else if (error.message.includes('email')) {
          return res.status(400).json({
            message: "An account with this email already exists. Please use a different email or try logging in."
          });
        }
      }

      res.status(400).json({ message: "Invalid registration data" });
    }
  });

// Check username availability
app.get("/api/auth/check-username/:username", async (req, res) => {
    try {
      const { username } = req.params;

      if (!username || username.length < 3) {
        return res.json({ available: false, message: "Username must be at least 3 characters" });
      }

      try {
        const existingUser = await storage.getUserByUsername(username);

        if (existingUser) {
          res.json({ available: false, message: "Username is already taken" });
        } else {
          res.json({ available: true, message: "Username is available" });
        }
      } catch (dbError) {
        // Check if this is a database connection error
        const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        const errorString = errorMessage.toLowerCase();
        const errorObj = dbError as any;

        // Check error code and details for connection issues
        const errorCode = errorObj?.code || errorObj?.originalError?.code || '';
        const errorDetails = errorObj?.details || errorObj?.originalError?.details || '';

        // More specific connection error detection
        const isConnectionError =
          errorString.includes('fetch failed') ||
          errorString.includes('failed to fetch from') ||
          errorString.includes('econnrefused') ||
          errorString.includes('enotfound') ||
          errorString.includes('timeout') ||
          errorString.includes('network') ||
          errorString.includes('dns') ||
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ETIMEDOUT' ||
          (errorString.includes('connection') && (
            errorString.includes('refused') ||
            errorString.includes('failed') ||
            errorString.includes('unavailable')
          )) ||
          // Supabase-specific connection errors
          errorString.includes('jwt') && errorString.includes('expired') ||
          errorString.includes('invalid api key') ||
          errorString.includes('service_role key');

        if (isConnectionError) {
          // Log for debugging with full error details
          console.warn('Database connection error during username check:', {
            message: errorMessage,
            code: errorCode,
            details: errorDetails,
            fullError: dbError
          });
          // Database is unavailable - return 503 with helpful message
          return res.status(503).json({
            available: null,
            message: "Database service unavailable. Please try again later.",
            code: "DATABASE_UNAVAILABLE"
          });
        }

        // Log other errors for debugging
        console.error('Username check database error (non-connection):', {
          message: errorMessage,
          code: errorCode,
          details: errorDetails,
          fullError: dbError
        });
        // Re-throw other database errors (like constraint violations, etc.)
        throw dbError;
      }
    } catch (error) {
      console.error('Username check error:', error);
      res.status(500).json({ available: false, message: "Error checking username. Please try again." });
    }
  });

// Check email availability  
app.get("/api/auth/check-email/:email", async (req, res) => {
    try {
      const { email } = req.params;

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.json({ available: false, message: "Please enter a valid email address" });
      }

      try {
        const existingUser = await storage.getUserByEmail(email);

        if (existingUser) {
          res.json({ available: false, message: "Email is already registered" });
        } else {
          res.json({ available: true, message: "Email is available" });
        }
      } catch (dbError) {
        // Check if this is a database connection error
        const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        const errorString = errorMessage.toLowerCase();
        const errorObj = dbError as any;

        // Check error code and details for connection issues
        const errorCode = errorObj?.code || errorObj?.originalError?.code || '';
        const errorDetails = errorObj?.details || errorObj?.originalError?.details || '';

        // More specific connection error detection
        const isConnectionError =
          errorString.includes('fetch failed') ||
          errorString.includes('failed to fetch from') ||
          errorString.includes('econnrefused') ||
          errorString.includes('enotfound') ||
          errorString.includes('timeout') ||
          errorString.includes('network') ||
          errorString.includes('dns') ||
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ETIMEDOUT' ||
          (errorString.includes('connection') && (
            errorString.includes('refused') ||
            errorString.includes('failed') ||
            errorString.includes('unavailable')
          )) ||
          // Supabase-specific connection errors
          errorString.includes('jwt') && errorString.includes('expired') ||
          errorString.includes('invalid api key') ||
          errorString.includes('service_role key');

        if (isConnectionError) {
          // Log for debugging with full error details
          console.warn('Database connection error during email check:', {
            message: errorMessage,
            code: errorCode,
            details: errorDetails,
            fullError: dbError
          });
          // Database is unavailable - return 503 with helpful message
          return res.status(503).json({
            available: null,
            message: "Database service unavailable. Please try again later.",
            code: "DATABASE_UNAVAILABLE"
          });
        }

        // Log other errors for debugging
        console.error('Email check database error (non-connection):', {
          message: errorMessage,
          code: errorCode,
          details: errorDetails,
          fullError: dbError
        });
        // Re-throw other database errors (like constraint violations, etc.)
        throw dbError;
      }
    } catch (error) {
      console.error('Email check error:', error);
      res.status(500).json({ available: false, message: "Error checking email. Please try again." });
    }
  });


app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);

      // Find user by username
      const user = await storage.getUserByUsername(username);

      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.passwordHash);

      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Create session
      const session = await createSession(user.id);

      // Return user info and token (excluding password hash)
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.json({
        user: userWithoutPassword,
        token: session.token
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(400).json({ message: "Invalid login data" });
    }
  });


app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      const session = req.session;
      if (!session) {
        return res.status(401).json({ message: "Session not found" });
      }
      await storage.deleteSession(session.token);
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ message: "Logout failed" });
    }
  });


app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ message: "Failed to get user info" });
    }
  });


app.get("/api/account/payments", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const freshUser = await storage.getUserById(user.id);
      const settings = normalizeAccountPaymentSettings(freshUser?.paymentSettings ?? null);
      res.json(settings);
    } catch (error) {
      console.error("Account payment settings fetch error", error);
      res.status(500).json({ message: "Unable to load payment settings" });
    }
  });


app.put("/api/account/payments", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const incoming = accountPaymentSettingsSchema.partial().parse(req.body ?? {});
      const existingUser = await storage.getUserById(user.id);
      const current = normalizeAccountPaymentSettings(existingUser?.paymentSettings ?? null);
      const next: AccountPaymentSettings = { ...current };

      if (Object.prototype.hasOwnProperty.call(incoming, "preferredProvider")) {
        next.preferredProvider = incoming.preferredProvider ?? null;
      }

      const applyStringUpdate = (
        key: keyof Omit<AccountPaymentSettings, "preferredProvider" | "updatedAt">,
        value: string | undefined,
      ) => {
        if (value && value.trim()) {
          (next as any)[key] = value.trim();
        } else {
          delete (next as any)[key];
        }
      };

      if (Object.prototype.hasOwnProperty.call(incoming, "stripeAccountId")) {
        applyStringUpdate("stripeAccountId", incoming.stripeAccountId);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "stripePublishableKey")) {
        applyStringUpdate("stripePublishableKey", incoming.stripePublishableKey);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "payoutStatementDescriptor")) {
        applyStringUpdate("payoutStatementDescriptor", incoming.payoutStatementDescriptor);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "paypalMerchantId")) {
        applyStringUpdate("paypalMerchantId", incoming.paypalMerchantId);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "paypalClientId")) {
        applyStringUpdate("paypalClientId", incoming.paypalClientId);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "paypalEmail")) {
        applyStringUpdate("paypalEmail", incoming.paypalEmail);
      }

      next.updatedAt = new Date().toISOString();

      const updated = await storage.updateUser(user.id, { paymentSettings: next });
      const responsePayload = normalizeAccountPaymentSettings(updated?.paymentSettings ?? next);
      res.json(responsePayload);
    } catch (error) {
      console.error("Account payment settings update error", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payment settings", issues: error.flatten() });
      }
      res.status(500).json({ message: "Unable to update payment settings" });
    }
  });


app.patch("/api/auth/preferences", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const payload = updateNotificationPreferencesSchema.parse(req.body ?? {});
      const sanitizedPhone = payload.phoneNumber ? payload.phoneNumber.replace(/[^0-9]/g, "") : null;
      const carrier = payload.carrier && payload.carrier.trim().length > 0 ? payload.carrier.trim() : null;
      const updated = await storage.updateUser(user.id, {
        phoneNumber: sanitizedPhone ?? null,
        carrier,
        notifyEmail: payload.notifyEmail ?? (user.notifyEmail ?? true),
        notifySms: payload.notifySms ?? (user.notifySms ?? false),
        notifyPairings: payload.notifyPairings ?? (user.notifyPairings ?? true),
        notifyRegistration: payload.notifyRegistration ?? (user.notifyRegistration ?? true),
        notifyTournamentStatus: payload.notifyTournamentStatus ?? (user.notifyTournamentStatus ?? true),
      });

      if (!updated) {
        return res.status(500).json({ message: "Failed to update preferences" });
      }

      const { passwordHash: _, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Update preferences error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid preferences" });
      }
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });


app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const payload = changePasswordSchema.parse(req.body ?? {});

      const matches = await verifyPassword(payload.currentPassword, user.passwordHash);
      if (!matches) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      if (payload.currentPassword === payload.newPassword) {
        return res.status(400).json({ message: "New password must be different" });
      }

      const passwordHash = await hashPassword(payload.newPassword);
      await storage.updateUser(user.id, { passwordHash });

      res.json({ message: "Password updated" });
    } catch (error) {
      console.error("Change password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payload" });
      }
      res.status(500).json({ message: "Failed to change password" });
    }
  });


app.delete("/api/auth/account", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      await storage.deleteSessionsByUser(user.id);
      await storage.deleteUser(user.id);

      res.json({ message: "Account deleted" });
    } catch (error) {
      console.error("Delete account error:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

// Get user by ID (for showing tournament creators)
app.get("/api/users/:id", async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return only public information
      const { passwordHash: _, ...publicUser } = user;
      res.json(publicUser);
    } catch (error) {
      console.error('Get user by ID error:', error);
      res.status(500).json({ message: "Failed to get user info" });
    }
  });

// Email verification routes
app.post("/api/auth/verify-email", async (req, res) => {
    try {
      const { code, email } = verifyEmailSchema.parse(req.body);

      // Try to get user from auth token if available, otherwise use email
      let user;
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const session = await storage.getSessionByToken(token);
        if (session && new Date() <= session.expiresAt) {
          user = await storage.getUserById(session.userId);
        }
      }

      // If no user from token, try email
      if (!user && email) {
        user = await storage.getUserByEmail(email);
      }

      if (!user) {
        return res.status(400).json({ message: "User not found. Please log in first or provide your email address." });
      }

      if (user.emailVerified) {
        return res.json({ message: "Email is already verified" });
      }

      // Verify code
      const verificationCode = await storage.getVerificationCodeByCode(code, user.id, 'email_verification');

      if (!verificationCode || verificationCode.used || new Date() > verificationCode.expiresAt) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }

      // Mark code as used and verify email
      await storage.useVerificationCode(code, user.id, 'email_verification');
      await storage.updateUser(user.id, { emailVerified: true });

      // Create session if user doesn't have one
      let token = authHeader?.substring(7);
      if (!token || !authHeader?.startsWith('Bearer ')) {
        const session = await createSession(user.id);
        token = session.token;
      }

      // Return updated user info
      const updatedUser = await storage.getUserById(user.id);
      const { passwordHash: _, ...userWithoutPassword } = updatedUser!;

      res.json({
        message: "Email verified successfully",
        user: userWithoutPassword,
        token: token
      });
    } catch (error) {
      console.error('Verify email error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid verification code format" });
      }
      res.status(400).json({ message: "Failed to verify email" });
    }
  });


app.post("/api/auth/resend-verification", async (req, res) => {
    try {
      // Get user from auth token or email
      const authHeader = req.headers.authorization;
      let user;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const session = await storage.getSessionByToken(token);
        if (session && new Date() <= session.expiresAt) {
          user = await storage.getUserById(session.userId);
        }
      }

      // If no user from token, try email
      if (!user) {
        const { email } = resendVerificationSchema.parse(req.body);
        if (email) {
          user = await storage.getUserByEmail(email);
        }
      }

      if (!user) {
        // Don't reveal if email exists for security
        return res.json({ message: "If the email exists, a verification code will be sent." });
      }

      if (user.emailVerified) {
        return res.json({ message: "Email is already verified" });
      }

      // Send verification code
      try {
        await sendEmailVerificationCode(user.id, user.email, user.firstName);
        res.json({ message: "Verification code sent to your email" });
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        res.status(500).json({ message: "Failed to send verification email. Please try again later." });
      }
    } catch (error) {
      console.error('Resend verification error:', error);
      res.status(400).json({ message: "Invalid request" });
    }
  });

// Forgot password routes
app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);

      // Find user by email
      const user = await storage.getUserByEmail(email);

      if (!user) {
        // Don't reveal if email exists for security
        return res.json({ message: "If the email exists, a reset code will be sent." });
      }

      // Send password reset code
      try {
        await sendPasswordResetCode(user.id, user.email, user.firstName);
        res.json({ message: "If the email exists, a reset code will be sent." });
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        res.status(500).json({ message: "Failed to send reset code. Please try again later." });
      }
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(400).json({ message: "Invalid request" });
    }
  });


app.post("/api/auth/forgot-username", async (req, res) => {
    try {
      const { email } = forgotUsernameSchema.parse(req.body);

      // Find user by email
      const user = await storage.getUserByEmail(email);

      if (!user) {
        // Don't reveal if email exists for security
        return res.json({ message: "If the email exists, the username will be sent." });
      }

      // In a real app, you'd send an email here
      // For now, we'll return the username (in production, never do this!)
      console.log(`Username for ${email}: ${user.username}`);

      res.json({
        message: "If the email exists, the username will be sent.",
        // Remove this in production - only for demo
        username: user.username
      });
    } catch (error) {
      console.error('Forgot username error:', error);
      res.status(400).json({ message: "Invalid request" });
    }
  });


app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email, code, newPassword } = resetPasswordSchema.parse(req.body);

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(400).json({ message: "Invalid reset code" });
      }

      // Find password reset record
      const passwordReset = await storage.getPasswordResetByCode(code, user.id);

      if (!passwordReset || passwordReset.used || new Date() > passwordReset.expiresAt) {
        return res.status(400).json({ message: "Invalid or expired reset code" });
      }

      // Hash new password and update user
      const passwordHash = await hashPassword(newPassword);
      await storage.updateUser(user.id, { passwordHash });

      // Mark reset code as used
      await storage.usePasswordReset(code, user.id);

      res.json({ message: "Password reset successfully. Please log in with your new password." });
    } catch (error) {
      console.error('Reset password error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid reset data" });
      }
      res.status(400).json({ message: "Invalid request" });
    }
  });

// Save Firebase Cloud Messaging token
app.post("/api/users/fcm-token", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      const { fcmToken } = req.body;
      if (!fcmToken || typeof fcmToken !== 'string') {
        return res.status(400).json({ error: "fcmToken is required and must be a string" });
      }

      const updatedUser = await storage.updateUser(user.id, { fcmToken });
      
      res.json({ message: "FCM token saved successfully", success: true });
    } catch (error) {
      console.error("Error saving FCM token:", error);
      res.status(500).json({ error: "Failed to save FCM token" });
    }
  });

}
