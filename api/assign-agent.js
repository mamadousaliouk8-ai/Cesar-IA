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

  const { memberId, agentId, assign } = req.body || {};
  if (!memberId || !agentId || typeof assign !== 'boolean') {
    return res.status(400).json({ error: "Paramètres invalides." });
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
      return res.status(400).json({ error: "Le propriétaire a déjà accès à tous les agents de l'organisation." });
    }

    const { data: adoption } = await supabase
      .from('adopted_agents')
      .select('id')
      .eq('org_id', caller.profile.org_id)
      .eq('agent_id', agentId)
      .maybeSingle();
    if (!adoption) {
      return res.status(400).json({ error: "Cet agent n'a pas été adopté par votre organisation." });
    }

    if (assign) {
      const { error } = await supabase
        .from('agent_assignments')
        .upsert(
          { org_id: caller.profile.org_id, agent_id: agentId, member_user_id: memberId },
          { onConflict: 'org_id,agent_id,member_user_id' }
        );
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('agent_assignments')
        .delete()
        .eq('org_id', caller.profile.org_id)
        .eq('agent_id', agentId)
        .eq('member_user_id', memberId);
      if (error) throw error;
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[assign-agent] Erreur:', err);
    return res.status(500).json({ error: err.message || "Erreur serveur." });
  }
}
