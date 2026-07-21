import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
// Ce endpoint doit pouvoir écrire pour un utilisateur qui n'est pas "connecté" au moment
// où Stripe nous notifie — il utilise donc volontairement la clé service_role (RLS bypass),
// l'authenticité de la requête étant garantie par la vérification de signature Stripe ci-dessous.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = (!supabaseUrl || !supabaseServiceKey) ? null : createClient(supabaseUrl, supabaseServiceKey);

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!stripe) {
    console.error('[Stripe Webhook] STRIPE_SECRET_KEY manquant.');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    if (!webhookSecret || !signature) throw new Error('Missing webhook secret or signature');
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    // Sans vérification de signature, n'importe qui pourrait POSTer un faux événement
    // "paiement réussi" et obtenir un agent gratuitement — on rejette systématiquement.
    console.warn('[Stripe Webhook] Signature invalide ou absente :', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;

  if (session.payment_status !== 'paid') {
    console.log(`[Stripe Webhook] Session ${session.id} pas encore payée (status: ${session.payment_status}).`);
    return res.status(200).json({ received: true, ignored: 'not paid yet' });
  }

  // On encode "userId::agentId" dans client_reference_id côté client avant la redirection Stripe.
  const refId = session.client_reference_id || '';
  const [userId, agentId] = refId.split('::');

  if (!userId || !agentId) {
    console.error(`[Stripe Webhook] client_reference_id invalide ou absent sur la session ${session.id}: "${refId}"`);
    return res.status(200).json({ received: true, ignored: 'missing client_reference_id' });
  }

  if (!supabase) {
    console.error('[Stripe Webhook] Supabase (service_role) non configuré, impossible de finaliser l\'adoption.');
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const { error: adoptErr } = await supabase
      .from('adopted_agents')
      .insert({ user_id: userId, agent_id: agentId });

    if (adoptErr && adoptErr.code !== '23505') {
      throw adoptErr;
    }

    const invoiceNo = `INV-${session.id.substring(session.id.length - 10).toUpperCase()}`;
    const amount = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;

    const { error: existingInvErr, data: existingInv } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('invoice_number', invoiceNo)
      .maybeSingle();

    if (!existingInvErr && !existingInv) {
      await supabase.from('invoices').insert({
        user_id: userId,
        invoice_number: invoiceNo,
        agent_name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
        price: amount,
        status: 'Payée'
      });
    }

    console.log(`[Stripe Webhook] Paiement confirmé et agent "${agentId}" adopté pour l'utilisateur ${userId}.`);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook] Erreur lors de la finalisation de l\'adoption :', err);
    // On renvoie une 500 pour que Stripe retente automatiquement l'envoi du webhook.
    return res.status(500).json({ error: err.message });
  }
}
