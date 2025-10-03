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
    throw new Error(
      "Supabase environment variables are not set. Please provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE/SUPABASE_KEY)."
    );
  }

  cachedClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        "X-Client-Info": "ChessTournamentManager/1.0",
      },
    },
  });

  return cachedClient;
}
