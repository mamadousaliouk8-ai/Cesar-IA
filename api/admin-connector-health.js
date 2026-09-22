import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (!supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL'))
  ? null
  : createClient(supabaseUrl, supabaseKey);

// Cette route lit connector_action_logs avec la clé service_role (donc pour
// TOUS les comptes, pas juste celui de l'appelant) — contrairement à la
// politique RLS de la table qui limite chaque utilisateur à ses propres
// lignes. C'est pour ça que le contrôle admin ci-dessous doit être strict.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée.' } });
  }
  if (!supabase) {
    return res.status(500).json({ error: { message: 'Configuration Supabase manquante côté serveur.' } });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Authentification requise.' } });
  }
  const token = authHeader.substring(7).trim();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: { message: 'Session expirée ou invalide. Veuillez vous reconnecter.' } });
    }

    // Même liste que api/chat.js et api/oauth-callback.js.
    const adminEmails = [
      'contact@cesar-ia.com',
      'admin@cesar-ia.com',
      'contact@césar-ia.com',
      'admin@césar-ia.com',
      'contact@xn--csar-ia-bya.com',
      'admin@xn--csar-ia-bya.com',
      'mamadousaliouk8@gmail.com',
      'manel.cheraiti@gmail.com'
    ];
    const isAdminEmail = user.email && adminEmails.includes(user.email.trim().toLowerCase());

    let isAdminProfile = false;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      if (profile) isAdminProfile = profile.is_admin;
    } catch (e) {
      console.warn('[admin-connector-health] Error checking profiles:', e);
    }

    if (!isAdminEmail && !isAdminProfile) {
      return res.status(403).json({ error: { message: "Accès réservé à l'administrateur de la plateforme." } });
    }

    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: logs, error: logsError } = await supabase
      .from('connector_action_logs')
      .select('connector_name, tool_name, success, error_message, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (logsError) {
      throw new Error(logsError.message);
    }

    const byConnector = {};
    for (const row of logs || []) {
      const key = row.connector_name || row.tool_name || 'Inconnu';
      if (!byConnector[key]) {
        byConnector[key] = { connector: key, attempts: 0, success: 0, failures: 0, lastError: null, lastErrorAt: null, lastUsedAt: null };
      }
      const bucket = byConnector[key];
      bucket.attempts += 1;
      if (row.success) {
        bucket.success += 1;
      } else {
        bucket.failures += 1;
        if (!bucket.lastErrorAt || row.created_at > bucket.lastErrorAt) {
          bucket.lastError = row.error_message;
          bucket.lastErrorAt = row.created_at;
        }
      }
      if (!bucket.lastUsedAt || row.created_at > bucket.lastUsedAt) {
        bucket.lastUsedAt = row.created_at;
      }
    }

    const summary = Object.values(byConnector).sort((a, b) => b.attempts - a.attempts);
    const totalAttempts = summary.reduce((sum, c) => sum + c.attempts, 0);
    const totalSuccess = summary.reduce((sum, c) => sum + c.success, 0);
    const failingConnectors = summary.filter(c => c.failures > 0).length;

    return res.status(200).json({
      summary,
      totals: {
        attempts: totalAttempts,
        successRate: totalAttempts > 0 ? Math.round((totalSuccess / totalAttempts) * 100) : 0,
        failingConnectors
      }
    });
  } catch (err) {
    console.error('[admin-connector-health] Erreur:', err);
    return res.status(500).json({ error: { message: err.message || 'Erreur interne.' } });
  }
}
