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

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: "Adresse e-mail invalide." });
  }
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (existingProfile) {
      return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail." });
    }

    const { data: existingInvite } = await supabase
      .from('org_invitations')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle();
    if (existingInvite) {
      return res.status(409).json({ error: "Une invitation est déjà en attente pour cette adresse e-mail." });
    }

    const { error: inviteRowErr } = await supabase
      .from('org_invitations')
      .insert({ org_id: caller.profile.org_id, email: normalizedEmail, invited_by: caller.user.id });
    if (inviteRowErr) throw inviteRowErr;

    const appUrl = process.env.APP_URL || 'https://plateforme-agents-ia.vercel.app';
    const { error: sendErr } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${appUrl}/?invite=1`
    });
    if (sendErr) {
      // L'invitation n'a pas pu être envoyée : on retire la ligne pour que le
      // propriétaire puisse réessayer proprement plutôt que de rester bloqué
      // sur un doublon "invitation déjà en attente".
      await supabase
        .from('org_invitations')
        .delete()
        .eq('org_id', caller.profile.org_id)
        .eq('email', normalizedEmail)
        .eq('status', 'pending');
      throw sendErr;
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[invite-member] Erreur:', err);
    return res.status(500).json({ error: err.message || "Erreur serveur lors de l'invitation." });
  }
}
