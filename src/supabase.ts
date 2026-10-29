
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "SUPABASE CONFIG ERROR: Missing URL or anonymous key. Check GitHub Actions secrets."
  );
}

if (!supabaseUrl.startsWith("https://")) {
  throw new Error(
    "SUPABASE CONFIG ERROR: Invalid Supabase URL."
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);
