import { createClient } from '@supabase/supabase-js';

const url = 'https://zsfoqqppwtqviopdhqug.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZm9xcXBwd3RxdmlvcGRocXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTg5MDUsImV4cCI6MjA5NTAzNDkwNX0.vblOV9Vyn1MAYqs_cskW7zZL3dRpr7YAdUHzXei8qYQ';

const supabase = createClient(url, key);

async function run() {
  console.log("Fetching all profiles...");
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) {
    console.error("Error fetching profiles:", error);
  } else {
    console.log("Profiles list:");
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
