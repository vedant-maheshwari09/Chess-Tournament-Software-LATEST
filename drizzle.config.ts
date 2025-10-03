import "dotenv/config";
import { defineConfig } from "drizzle-kit";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

function extractProjectRef(supabaseUrl: string): string | undefined {
  try {
    const { hostname } = new URL(supabaseUrl);
    const [projectRef] = hostname.split(".");
    return projectRef;
  } catch {
    return undefined;
  }
}

function resolveDatabaseUrl(): string {
  const urls = [
    readEnv("DATABASE_URL"),
    readEnv("SUPABASE_DB_URL"),
    readEnv("SUPABASE_POSTGRES_URL"),
    readEnv("SUPABASE_DATABASE_URL"),
    readEnv("SUPABASE_CONNECTION_STRING"),
  ];

  for (const url of urls) {
    if (url) {
      return url;
    }
  }

  const host = readEnv("SUPABASE_DB_HOST");
  const port = readEnv("SUPABASE_DB_PORT") ?? "5432";
  const user = readEnv("SUPABASE_DB_USER") ?? "postgres";
  const password = readEnv("SUPABASE_DB_PASSWORD");
  const database = readEnv("SUPABASE_DB_NAME") ?? readEnv("SUPABASE_DB_DATABASE") ?? "postgres";

  if (host && password) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  }

  const supabaseUrl = readEnv("SUPABASE_URL");
  if (supabaseUrl) {
    const passwordCandidates = [
      readEnv("SUPABASE_DB_PASSWORD"),
      readEnv("SUPABASE_SERVICE_ROLE_KEY"),
      readEnv("SUPABASE_SERVICE_ROLE"),
      readEnv("SUPABASE_KEY"),
      readEnv("SUPABASE_ANON_KEY"),
    ];
    const passwordCandidate = passwordCandidates.find((value): value is string => typeof value === "string" && value.length > 0);
    const projectRef = extractProjectRef(supabaseUrl);

    if (passwordCandidate && projectRef) {
      return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(passwordCandidate)}@db.${projectRef}.supabase.co:${port}/${database}`;
    }
  }

  throw new Error(
    "Database connection string is not configured. Set DATABASE_URL or the appropriate Supabase variables (e.g. SUPABASE_DB_URL or SUPABASE_DB_HOST/SUPABASE_DB_PASSWORD).",
  );
}

const url = resolveDatabaseUrl();

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
