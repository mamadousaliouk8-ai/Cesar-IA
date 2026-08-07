import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = (!supabaseUrl || !supabaseServiceKey)
  ? null
  : createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function requireOrgOwner(req, res) {
  if (!supabase) {
    res.status(500).json({ error: "Configuration serveur Supabase manquante (clé service_role)." });
    return null;
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: "Authentification requise." });
    return null;
  }

  const token = authHeader.substring(7).trim();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Session expirée ou invalide. Veuillez vous reconnecter." });
    return null;
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('org_id, role, status')
    .eq('id', user.id)
    .single();
  if (profileErr || !profile) {
    res.status(403).json({ error: "Profil introuvable." });
    return null;
  }
  if (profile.role !== 'owner' || profile.status !== 'active') {
    res.status(403).json({ error: "Seul le propriétaire de l'organisation peut effectuer cette action." });
    return null;
  }

  return { user, profile };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const caller = await requireOrgOwner(req, res);
  if (!caller) return;

  const { memberId, action } = req.body || {};
  if (!memberId || !['disable', 'enable', 'remove'].includes(action)) {
    return res.status(400).json({ error: "Paramètres invalides." });
  }
  if (memberId === caller.user.id) {
    return res.status(400).json({ error: "Vous ne pouvez pas modifier votre propre statut." });
  }

  try {
    const { data: target, error: targetErr } = await supabase
      .from('profiles')
      .select('id, org_id, role')
      .eq('id', memberId)
      .single();
    if (targetErr || !target || target.org_id !== caller.profile.org_id) {
      return res.status(404).json({ error: "Membre introuvable dans votre organisation." });
    }
    if (target.role === 'owner') {
      return res.status(400).json({ error: "Impossible de modifier le propriétaire de l'organisation." });
    }

    // "remove" reste une désactivation réversible (pas de suppression du compte
    // Auth) : on coupe simplement tous les accès aux agents attribués.
    if (action === 'remove') {
      await supabase
        .from('agent_assignments')
        .delete()
        .eq('org_id', caller.profile.org_id)
        .eq('member_user_id', memberId);
    }

    const status = action === 'enable' ? 'active' : 'disabled';
    const { error } = await supabase.from('profiles').update({ status }).eq('id', memberId);
    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[manage-member] Erreur:', err);
    return res.status(500).json({ error: err.message || "Erreur serveur." });
  }
}
