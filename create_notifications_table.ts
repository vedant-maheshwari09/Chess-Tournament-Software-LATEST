import pkg from 'pg';
import { config } from 'dotenv';
config();
const { Pool } = pkg;

// Build connection string from Supabase env vars
const supabaseUrl = process.env.SUPABASE_URL!;
const password = process.env.SUPABASE_DB_PASSWORD!;
const hostname = new URL(supabaseUrl).hostname;
const projectRef = hostname.split('.')[0];
const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

pool.query(`
    CREATE TABLE IF NOT EXISTS "notifications" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "title" text NOT NULL,
        "message" text NOT NULL,
        "type" text DEFAULT 'info' NOT NULL,
        "read" boolean DEFAULT false NOT NULL,
        "meta" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
    );

    DO $$ BEGIN
     ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION
     WHEN duplicate_object THEN null;
    END $$;
`).then(() => {
    console.log("✅ Successfully created notifications table");
    process.exit(0);
}).catch(e => {
    console.error("❌ Failed:", e.message);
    process.exit(1);
});
