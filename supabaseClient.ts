import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ override: true });

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    process.env.SUPABASE_KEY ??
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceKey) {
    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE/SUPABASE_KEY)");
    
    console.error("❌ Supabase environment variables missing:", missing.join(", "));
    console.error("💡 Please check your .env file in the project root directory");
    throw new Error(
      `Supabase environment variables are not set. Missing: ${missing.join(", ")}. Please provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.`
    );
  }

  // Warn if using ANON_KEY instead of SERVICE_ROLE_KEY
  if (process.env.SUPABASE_ANON_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY && 
      !process.env.SUPABASE_SERVICE_ROLE && !process.env.SUPABASE_KEY) {
    console.warn("⚠️  Using SUPABASE_ANON_KEY instead of SUPABASE_SERVICE_ROLE_KEY.");
    console.warn("   The ANON_KEY has limited permissions and may cause errors for server-side operations.");
    console.warn("   For production use, please set SUPABASE_SERVICE_ROLE_KEY in your .env file.");
  }

  try {
    cachedClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          "X-Client-Info": "ChessTournamentManager/1.0",
        },
      },
    });
    console.log("✅ Supabase client initialized successfully");
  } catch (error) {
    console.error("❌ Failed to create Supabase client:", error);
    throw error;
  }

  return cachedClient;
}
