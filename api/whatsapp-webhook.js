import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (!supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL'))
  ? null
  : createClient(supabaseUrl, supabaseKey);

// Normaliser un numéro de téléphone pour comparaison (ne garde que les chiffres)
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Validation du Webhook (Requête GET de validation de Meta)
  if (req.method === 'GET') {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'cesar_verify_token_default';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        console.log('[WhatsApp Webhook] Webhook vérifié avec succès.');
        return res.status(200).send(challenge);
      } else {
        return res.status(403).json({ error: 'Verify token mismatch' });
      }
    }
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // 2. Traitement des notifications de messages (Requête POST de Meta)
  if (req.method === 'POST') {
    try {
      const body = req.body;

      if (!body.object || body.object !== 'whatsapp_business_account') {
        return res.status(404).json({ error: 'Not a WhatsApp event' });
      }

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return res.status(200).json({ status: 'No messages to process' });
      }

      const fromPhone = message.from; // Numéro de téléphone de l'expéditeur
      const messageId = message.id;
      const messageType = message.type; // text, image, video

      console.log(`[WhatsApp Webhook] Message reçu de ${fromPhone} de type ${messageType}`);

      // Rechercher l'utilisateur associé à ce numéro de téléphone dans Supabase
      let matchingConnector = null;
      if (supabase) {
        const { data: connectors, error: connErr } = await supabase
          .from('connectors')
          .select('*')
          .in('connector_name', ['WhatsApp', 'WhatsApp Business API']);

        if (!connErr && connectors) {
          matchingConnector = connectors.find(c => {
            const phone = c.credentials?.phone || c.credentials?.token || '';
            return normalizePhone(phone) === normalizePhone(fromPhone);
          });
        }
      }

      // Si aucun connecteur n'est trouvé, on retourne un message (sans bloquer Meta)
      if (!matchingConnector) {
        console.warn(`[WhatsApp Webhook] Aucun connecteur WhatsApp trouvé pour le numéro : ${fromPhone}`);
        // Dans une implémentation réelle, on pourrait envoyer un WhatsApp pour dire "Associez votre numéro dans votre espace César-IA"
        return res.status(200).json({ error: 'No matching user found' });
      }

      const { user_id: userId, agent_id: agentId } = matchingConnector;

      // Vérifier si l'utilisateur a effectivement adopté cet agent
      if (supabase) {
        const { data: adoption, error: adoptErr } = await supabase
          .from('adopted_agents')
          .select('*')
          .eq('user_id', userId)
          .eq('agent_id', agentId);

        if (adoptErr || !adoption || adoption.length === 0) {
          console.warn(`[WhatsApp Webhook] L'utilisateur ${userId} a configuré un connecteur WhatsApp mais n'a pas adopté l'agent ${agentId}.`);
          return res.status(200).json({ error: 'Agent not adopted by this user' });
        }
      }

      let textContent = '';
      let mediaUrl = '';
      let mediaMimeType = '';

      // 3. Extraction du texte et du média
      if (messageType === 'text') {
        textContent = message.text?.body || '';
      } else if (messageType === 'image') {
        textContent = message.image?.caption || 'Image partagée via WhatsApp';
        const mediaId = message.image?.id;
        mediaMimeType = message.image?.mime_type;
        mediaUrl = await getWhatsAppMediaUrl(mediaId);
      } else if (messageType === 'video') {
        textContent = message.video?.caption || 'Vidéo partagée via WhatsApp';
        const mediaId = message.video?.id;
        mediaMimeType = message.video?.mime_type;
        mediaUrl = await getWhatsAppMediaUrl(mediaId);
      }

      // 4. Analyse par Gemini et génération du post
      const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      let generatedPostText = '';

      if (apiKey) {
        generatedPostText = await analyzeAndDraftPost(textContent, mediaUrl, mediaMimeType, apiKey);
      } else {
        generatedPostText = `[Simulé] Événement partagé aujourd'hui ! Content d'avoir pu échanger avec tout le monde autour de nos dernières innovations. 🚀 #Evenement #Networking\n\nTexte d'origine : ${textContent}`;
      }

      // 4b. Récupérer tous les connecteurs configurés de l'utilisateur pour cet agent
      let userConnectors = {};
      let activePlatforms = [];

      if (supabase) {
        try {
          const { data: allConns, error: allConnsErr } = await supabase
            .from('connectors')
            .select('*')
            .eq('user_id', userId)
            .eq('agent_id', agentId);
            
          if (!allConnsErr && allConns) {
            allConns.forEach(c => {
              userConnectors[c.connector_name] = c.credentials || {};
            });
          }
        } catch (eDb) {
          console.error('[WhatsApp Webhook] Erreur lors de la récupération des connecteurs:', eDb);
        }
      }

      // Helper pour vérifier si un connecteur est configuré
      function hasCreds(info) {
        return info && (info.token || info.accessToken || info.apiKey || info.webhookUrl || info.sender || info.phone);
      }

      // Safe helper pour récupérer les infos
      function getConnectorInfo(connectors, name) {
        if (!connectors) return null;
        if (connectors[name]) return connectors[name];
        const entry = Object.entries(connectors).find(([k]) => k && typeof k === 'string' && k.toLowerCase().includes(name.toLowerCase()));
        return entry ? entry[1] : null;
      }

      // Détecter les plateformes de publication actives
      if (hasCreds(getConnectorInfo(userConnectors, "LinkedIn"))) activePlatforms.push("linkedin");
      if (hasCreds(getConnectorInfo(userConnectors, "Twitter")) || hasCreds(getConnectorInfo(userConnectors, "X"))) activePlatforms.push("twitter");
      if (hasCreds(getConnectorInfo(userConnectors, "Facebook"))) activePlatforms.push("facebook");
      if (hasCreds(getConnectorInfo(userConnectors, "Instagram"))) activePlatforms.push("instagram");
      if (hasCreds(getConnectorInfo(userConnectors, "TikTok"))) activePlatforms.push("tiktok");
      if (hasCreds(getConnectorInfo(userConnectors, "YouTube"))) activePlatforms.push("youtube");
      if (hasCreds(getConnectorInfo(userConnectors, "Pinterest"))) activePlatforms.push("pinterest");
      if (hasCreds(getConnectorInfo(userConnectors, "Threads"))) activePlatforms.push("threads");
      if (hasCreds(getConnectorInfo(userConnectors, "Buffer")) || hasCreds(getConnectorInfo(userConnectors, "Hootsuite"))) activePlatforms.push("buffer");

      // Par défaut toujours LinkedIn
      if (activePlatforms.length === 0) {
        activePlatforms.push("linkedin");
      }

      // 5. Enregistrement du brouillon dans le connecteur WhatsApp de l'utilisateur
      const currentCredentials = matchingConnector.credentials || {};
      const drafts = currentCredentials.drafts || [];

      const newDraft = {
        id: `wa_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        text: generatedPostText,
        mediaUrl: mediaUrl || null,
        mediaType: messageType,
        status: 'draft',
        platforms: activePlatforms,
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Par défaut demain à la même heure
        created_at: new Date().toISOString()
      };

      drafts.push(newDraft);
      currentCredentials.drafts = drafts;

      if (supabase && matchingConnector) {
        await supabase
          .from('connectors')
          .update({ credentials: currentCredentials })
          .eq('user_id', userId)
          .eq('agent_id', agentId)
          .eq('connector_name', matchingConnector.connector_name);
      }

      // 5b. Notification en direct vers Slack, Teams ou Webhook si connectés
      const slackInfo = getConnectorInfo(userConnectors, "Slack");
      if (hasCreds(slackInfo)) {
        const webhookUrl = slackInfo.webhookUrl || slackInfo.token;
        if (webhookUrl && webhookUrl.startsWith("http")) {
          try {
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: `📱 *[Chronos via WhatsApp]* Nouveau post rédigé en brouillon :\n\n"${generatedPostText}"\n\n🔗 Valider sur César-IA : https://plateforme-agents-ia.vercel.app/?validate_draft=${newDraft.id}`
              })
            });
          } catch (e) {
            console.error('[WhatsApp Webhook] Échec notification Slack:', e);
          }
        }
      }

      const teamsInfo = getConnectorInfo(userConnectors, "Teams");
      if (hasCreds(teamsInfo)) {
        const webhookUrl = teamsInfo.webhookUrl || teamsInfo.token;
        if (webhookUrl && webhookUrl.startsWith("http")) {
          try {
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: `📱 *[Chronos via WhatsApp]* Nouveau post rédigé en brouillon :\n\n"${generatedPostText}"\n\n🔗 Valider sur César-IA : https://plateforme-agents-ia.vercel.app/?validate_draft=${newDraft.id}`
              })
            });
          } catch (e) {
            console.error('[WhatsApp Webhook] Échec notification Teams:', e);
          }
        }
      }

      const webhookInfo = getConnectorInfo(userConnectors, "Webhook");
      if (hasCreds(webhookInfo)) {
        const webhookUrl = webhookInfo.webhookUrl || webhookInfo.url;
        if (webhookUrl && webhookUrl.startsWith("http")) {
          try {
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: "whatsapp_message_received",
                agent_id: agentId,
                user_id: userId,
                text: generatedPostText,
                originalText: textContent,
                mediaUrl: mediaUrl || null,
                draftId: newDraft.id
              })
            });
          } catch (e) {
            console.error('[WhatsApp Webhook] Échec webhook personnalisé:', e);
          }
        }
      }

      // 6. Réponse sur WhatsApp à l'utilisateur
      await sendWhatsAppReply(fromPhone, generatedPostText, newDraft.id);

      return res.status(200).json({ status: 'success', draftId: newDraft.id });
    } catch (err) {
      console.error('[WhatsApp Webhook] Erreur interne :', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Fonction pour récupérer l'URL publique du média via l'API de Meta
async function getWhatsAppMediaUrl(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !mediaId) return '';

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      return data.url || '';
    }
  } catch (e) {
    console.error('[WhatsApp Webhook] Erreur de récupération du média URL :', e);
  }
  
  // MOCK fallback pour démo locale ou en attente des clés
  return `https://images.unsplash.com/photo-1515187029135-18ee286d815b?q=80&w=600&auto=format&fit=crop`;
}

// Fonction pour envoyer un message WhatsApp de retour
async function sendWhatsAppReply(toPhone, postText, draftId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    console.log(`[WhatsApp Reply MOCK] Destinataire: ${toPhone}\nMessage: Nouveau post rédigé avec succès ! Voici le brouillon :\n\n${postText}\n\nLien de validation rapide : https://plateforme-agents-ia.vercel.app/?validate_draft=${draftId}`);
    return;
  }

  const cleanText = `✍️ *Nouveau post rédigé par Chronos !*\n\n${postText}\n\n🔗 Valider et planifier sur le calendrier en 1 clic : https://plateforme-agents-ia.vercel.app/?validate_draft=${draftId}`;

  try {
    await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: cleanText }
      })
    });
  } catch (e) {
    console.error('[WhatsApp Webhook] Erreur lors de l\'envoi de la réponse WhatsApp :', e);
  }
}

// Fonction d'analyse Gemini Multimodale simplifiée
async function analyzeAndDraftPost(message, mediaUrl, mimeType, apiKey) {
  const parts = [];

  if (mediaUrl) {
    try {
      const imgRes = await fetch(mediaUrl);
      if (imgRes.ok) {
        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        parts.push({
          inlineData: {
            mimeType: mimeType || 'image/jpeg',
            data: base64
          }
        });
      }
    } catch (e) {
      console.error("[WhatsApp Webhook Gemini] Impossible de télécharger l'image :", e);
    }
  }

  parts.push({
    text: `Tu es Chronos, un agent marketing autonome et multi-canal spécialisé dans la rédaction pour les réseaux sociaux (LinkedIn, X/Twitter, Facebook, Instagram, Slack, WhatsApp).
Un utilisateur t'envoie un média et/ou un message depuis son téléphone lors d'un événement.
Ton but est de rédiger une proposition de post adaptée aux réseaux sociaux visés pour résumer cet événement.

Consignes de comportement multi-canal, d'analyse d'intention et d'extraction d'éléments :
1. **DÉTECTION DU RÉSEAU & EXTRACTION** :
   - Détermine quel(s) réseau(x) social(aux) est/sont visé(s) par le message. Si aucun n'est spécifié, prépare par défaut une version LinkedIn (style professionnel) et une version courte X/Twitter (moins de 280 caractères).
   - Repère et extrais méticuleusement toutes les informations importantes du message (projets précis, résultats chiffrés, technologies, noms de participants, dates, etc.) pour les incorporer de manière intelligente et réaliste dans tes rédactions de posts.
2. **ADAPTATION DU STYLE** :
   - **LinkedIn** : Professionnel, aéré (sauts de ligne, phrases courtes), sans listes à puces robotiques, 2-3 emojis max.
   - **X (Twitter)** : Moins de 280 caractères, accrocheur, ou structuré en thread si le message est très long.
   - **Instagram / Facebook** : Ton chaleureux, plus d'emojis contextuels et hashtags regroupés en bas.
3. **HASHTAGS & MENTIONS** :
   - À la fin du message, demande systématiquement à l'utilisateur s'il y a des personnes à mentionner (@Nom) ou des hashtags (#) spécifiques à ajouter.

Consigne de style : Copywriting humain, percutant, structuré en paragraphes aérés, avec emojis contextuels pertinents et hashtags de portée.

Contexte fourni par l'utilisateur : "${message}"
${mediaUrl ? "Une image de l'événement a été fournie et attachée. Analyse visuellement ce qu'elle montre pour l'intégrer avec intelligence et réalisme dans le texte du post." : ""}

Consignes de formatage de ta réponse :
- Renvoie les versions rédigées pour les réseaux concernés suivies de tes questions sur les mentions et hashtags à la fin.
- N'ajoute aucune introduction, aucune salutation globale ni commentaire externe explicatif (pas de "Voici le post rédigé :").`
  });

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        generationConfig: { temperature: 0.7 }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur de génération.";
    }
  } catch (err) {
    console.error("[WhatsApp Webhook Gemini] Erreur de génération :", err);
  }

  return `Super événement aujourd'hui ! Content d'avoir pu échanger avec tout le monde. 🚀 #Evenement #Networking`;
}
