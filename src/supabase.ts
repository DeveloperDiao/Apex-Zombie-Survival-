import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  "https://utdpogwhemhpurnadmsx.supabase.co/rest/v1/";

const SUPABASE_PUBLISHABLE_KEY =
  “sb_publishable_vGjODZp5gTglY6a8-aaseg_fSNuGtRy";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  }
);
