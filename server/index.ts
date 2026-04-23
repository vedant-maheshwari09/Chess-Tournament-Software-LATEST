import path from "path";
import { fileURLToPath } from 'url';
import { config as loadEnv } from "dotenv";
import express, { type Request, Response, NextFunction } from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(`[${new Date().toLocaleTimeString()}] 🚀 Server process starting (PID: ${process.pid})...`);

const envLoaded = loadEnv();
if (envLoaded.error) {
  console.warn("⚠️  Failed to load .env from process cwd", envLoaded.error);
} else {
  console.log("✅ Loaded .env file from:", process.cwd());
}

// Check for Supabase variables early
const hasSupabaseUrl = !!process.env.SUPABASE_URL;
const hasSupabaseKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY);
if (!hasSupabaseUrl || !hasSupabaseKey) {
  console.warn("⚠️  Supabase environment variables not found. Database features will not work.");
  console.warn("💡 Please create a .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

if (!process.env.GEMINI_API_KEY) {
  const fallbackPath = path.resolve(__dirname, "..", ".env");
  const fallbackLoad = loadEnv({ path: fallbackPath, override: false });
  if (fallbackLoad.error) {
    console.warn(`⚠️  Attempted fallback .env load at ${fallbackPath} but failed`, fallbackLoad.error);
  } else if (fallbackLoad.parsed) {
    console.log("✅ Loaded .env file from fallback path:", fallbackPath);
    // Re-check Supabase after fallback load
    const hasSupabaseUrlAfter = !!process.env.SUPABASE_URL;
    const hasSupabaseKeyAfter = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY);
    if (hasSupabaseUrlAfter && hasSupabaseKeyAfter) {
      console.log("✅ Supabase environment variables found after fallback load");
    }
  }
}
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { preloadRatingData } from "./lib/localRatings";
import { bootstrapArenaPairing } from "./lib/arenaPairing";

const app = express();
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      if ((req.originalUrl ?? "").startsWith("/api/payments/stripe-webhook")) {
        (req as any).rawBody = Buffer.from(buf);
      }
    },
  }),
);
app.use(express.urlencoded({ extended: false }));

// Serve static files from the 'attached_assets' directory
app.use('/attached_assets', express.static(path.join(__dirname, '..', 'attached_assets')));

// Add CORS headers for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += `\nRESPONSE: ${JSON.stringify(capturedJsonResponse, null, 2)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Always serve the app on PORT env (default 5010)
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = Number(process.env.PORT ?? 5010);

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      log(`port ${port} is already in use. Stop the conflicting process or set PORT to a free value.`, "express");
      process.exit(1);
    }

    throw error;
  });

  const shutdown = () => {
    log("shutting down server", "express");
    server.close(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  server.listen({
    port,
    host: "0.0.0.0",
  }, async () => {
    log(`serving on port ${port}`);
    
    // Background initialization after port is bound
    try {
      log("Pre-loading rating data...", "express");
      await preloadRatingData();
      log("Rating data loaded.", "express");

      // Restart auto-pairing loops for any arena tournaments that were active before server restart
      log("Bootstrapping arena pairings...", "express");
      await bootstrapArenaPairing();
      log("Arena pairings bootstrapped.", "express");
    } catch (err) {
      log(`Post-startup initialization failed: ${err}`, "express");
    }
  });
})();
