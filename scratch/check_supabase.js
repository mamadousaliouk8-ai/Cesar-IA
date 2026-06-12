
const supabaseUrl = 'https://zsfoqqppwtqviopdhqug.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZm9xcXBwd3RxdmlvcGRocXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NTg5MDUsImV4cCI6MjA5NTAzNDkwNX0.vblOV9Vyn1MAYqs_cskW7zZL3dRpr7YAdUHzXei8qYQ';

async function test() {
  console.log("1. Testing GET /rest/v1/stripe_links...");
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/stripe_links`, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`
      }
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (e) {
    console.error("GET Error:", e);
  }

  console.log("\n2. Testing POST /rest/v1/stripe_links (Upsert)...");
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/stripe_links?on_conflict=agent_id`, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ agent_id: 'test_sybil', url: 'https://buy.stripe.com/test' })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (e) {
    console.error("POST Error:", e);
  }

  console.log("\n3. Testing DELETE /rest/v1/stripe_links...");
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/stripe_links?agent_id=eq.test_sybil`, {
      method: 'DELETE',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`
      }
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (e) {
    console.error("DELETE Error:", e);
  }
}

test();
