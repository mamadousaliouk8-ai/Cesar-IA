import { createClient } from '@supabase/supabase-js';

const url = 'https://zsfoqqppwtqviopdhqug.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZm9xcXBwd3RxdmlvcGRocXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTg5MDUsImV4cCI6MjA5NTAzNDkwNX0.vblOV9Vyn1MAYqs_cskW7zZL3dRpr7YAdUHzXei8qYQ';

console.log("Initializing Supabase client with url:", url);
const supabase = createClient(url, key);

async function run() {
  console.log("Querying profiles...");
  try {
    const start = Date.now();
    const { data, error } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', '0160ab2d-9834-4566-afdf-0c371499cb22')
      .single();
    const duration = Date.now() - start;
    console.log(`Query finished in ${duration}ms`);
    console.log("Data:", data);
    console.log("Error:", error);
  } catch (err) {
    console.error("Caught error:", err);
  }
}

run();
