import { createClient } from "@supabase/supabase-js";

const supabaseUrl = 'https://mngoftqnimynaxmmfnng.supabase.co'
const supabaseKey="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZ29mdHFuaW15bmF4bW1mbm5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA4MDYzMjMsImV4cCI6MjA1NjM4MjMyM30.ZSZHtdH_RcO6CMM3P-DKxv9O55-nfKdvHiGwP4LA_y8"

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
