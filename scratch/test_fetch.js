const supabaseUrl = 'https://zsfoqqppwtqviopdhqug.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZm9xcXBwd3RxdmlvcGRocXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTg5MDUsImV4cCI6MjA5NTAzNDkwNX0.vblOV9Vyn1MAYqs_cskW7zZL3dRpr7YAdUHzXei8qYQ';

const uid = '0160ab2d-9834-4566-afdf-0c371499cb22';
const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${uid}&select=is_admin`;

async function run() {
  console.log("Fetching URL:", url);
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey
      }
    });
    console.log("Status:", res.status, res.statusText);
    const data = await res.json();
    console.log("Data:", data);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
