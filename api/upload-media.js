export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileData, mimeType, message } = req.body;

    if (!fileData) {
      return res.status(400).json({ error: 'fileData requis.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'Clé API Gemini non configurée sur le serveur.' });
    }

    // Extraction des données brutes en base64
    const base64Data = fileData.split(',')[1] || fileData;

    const parts = [
      {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: base64Data
        }
      },
      {
        text: `Tu es Chronos, un agent marketing autonome spécialisé dans la rédaction de publications réseaux sociaux (comme LinkedIn, Twitter, Facebook).
Un utilisateur t'envoie un média (photo ou vidéo) depuis son tableau de bord et te demande de rédiger un post à son sujet.

Consigne de style : Copywriting humain, percutant, structuré en paragraphes aérés, avec emojis contextuels pertinents et hashtags de portée.

Contexte ou consigne de l'utilisateur : "${message || 'Rédige un post inspirant à partir de ce média'}"

Consignes de formatage de ta réponse :
- Renvoie uniquement le texte final du post, prêt à être publié directement.
- N'ajoute aucun commentaire externe, introduction ni formule de politesse.`
      }
    ];

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        generationConfig: { temperature: 0.7 }
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur Gemini.' });
    }

    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Impossible de générer le texte.';

    return res.status(200).json({
      text: generatedText,
      mediaUrl: fileData // Renvoyer le base64 pour affichage immédiat côté client
    });
  } catch (err) {
    console.error('[Upload Media Error]:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
