import { createClient } from '@supabase/supabase-js';

const OAUTH_PROVIDERS = {
  canva: {
    tokenUrl: 'https://api.canva.com/rest/v1/oauth/token',
    clientIdEnv: 'CANVA_CLIENT_ID',
    clientSecretEnv: 'CANVA_CLIENT_SECRET',
  },
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  linkedin: {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
  },
  slack: {
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
  },
  twitter: {
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    clientIdEnv: 'TWITTER_CLIENT_ID',
    clientSecretEnv: 'TWITTER_CLIENT_SECRET',
  },
  meta: {
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
  },
  github: {
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
  },
  hubspot: {
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    clientIdEnv: 'HUBSPOT_CLIENT_ID',
    clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
  },
  salesforce: {
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    clientIdEnv: 'SALESFORCE_CLIENT_ID',
    clientSecretEnv: 'SALESFORCE_CLIENT_SECRET',
  },
  airtable: {
    tokenUrl: 'https://airtable.com/oauth2/v1/token',
    clientIdEnv: 'AIRTABLE_CLIENT_ID',
    clientSecretEnv: 'AIRTABLE_CLIENT_SECRET',
  },
  buffer: {
    tokenUrl: 'https://api.bufferapp.com/1/oauth2/token.json',
    clientIdEnv: 'BUFFER_CLIENT_ID',
    clientSecretEnv: 'BUFFER_CLIENT_SECRET',
  },
  pinterest: {
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    clientIdEnv: 'PINTEREST_CLIENT_ID',
    clientSecretEnv: 'PINTEREST_CLIENT_SECRET',
  },
  notion: {
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    clientIdEnv: 'NOTION_CLIENT_ID',
    clientSecretEnv: 'NOTION_CLIENT_SECRET',
  },
  asana: {
    tokenUrl: 'https://app.asana.com/-/oauth_token',
    clientIdEnv: 'ASANA_CLIENT_ID',
    clientSecretEnv: 'ASANA_CLIENT_SECRET',
  },
  monday: {
    tokenUrl: 'https://auth.monday.com/oauth2/token',
    clientIdEnv: 'MONDAY_CLIENT_ID',
    clientSecretEnv: 'MONDAY_CLIENT_SECRET',
  },
  clickup: {
    tokenUrl: 'https://app.clickup.com/api/v2/oauth/token',
    clientIdEnv: 'CLICKUP_CLIENT_ID',
    clientSecretEnv: 'CLICKUP_CLIENT_SECRET',
  },
  discord: {
    tokenUrl: 'https://discord.com/api/oauth2/token',
    clientIdEnv: 'DISCORD_CLIENT_ID',
    clientSecretEnv: 'DISCORD_CLIENT_SECRET',
  },
  atlassian: {
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    clientIdEnv: 'ATLASSIAN_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_CLIENT_SECRET',
  },
  gitlab: {
    tokenUrl: 'https://gitlab.com/oauth/token',
    clientIdEnv: 'GITLAB_CLIENT_ID',
    clientSecretEnv: 'GITLAB_CLIENT_SECRET',
  },
  bitbucket: {
    tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
    clientIdEnv: 'BITBUCKET_CLIENT_ID',
    clientSecretEnv: 'BITBUCKET_CLIENT_SECRET',
  },
  box: {
    tokenUrl: 'https://api.box.com/oauth2/token',
    clientIdEnv: 'BOX_CLIENT_ID',
    clientSecretEnv: 'BOX_CLIENT_SECRET',
  },
  stripe: {
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    clientIdEnv: 'STRIPE_CLIENT_ID',
    clientSecretEnv: 'STRIPE_CLIENT_SECRET',
  },
  paypal: {
    tokenUrl: 'https://api-m.paypal.com/v1/oauth2/token',
    clientIdEnv: 'PAYPAL_CLIENT_ID',
    clientSecretEnv: 'PAYPAL_CLIENT_SECRET',
  },
  webflow: {
    tokenUrl: 'https://api.webflow.com/oauth/access_token',
    clientIdEnv: 'WEBFLOW_CLIENT_ID',
    clientSecretEnv: 'WEBFLOW_CLIENT_SECRET',
  },
  shopify: {
    tokenUrl: 'https://{shop}/admin/oauth/access_token',
    clientIdEnv: 'SHOPIFY_CLIENT_ID',
    clientSecretEnv: 'SHOPIFY_CLIENT_SECRET',
  },
  wordpress: {
    tokenUrl: 'https://public-api.wordpress.com/oauth2/token',
    clientIdEnv: 'WORDPRESS_CLIENT_ID',
    clientSecretEnv: 'WORDPRESS_CLIENT_SECRET',
  },
  crisp: {
    tokenUrl: 'https://api.crisp.chat/v1/oauth/token',
    clientIdEnv: 'CRISP_CLIENT_ID',
    clientSecretEnv: 'CRISP_CLIENT_SECRET',
  },
  zendesk: {
    tokenUrl: 'https://{shop}/oauth/tokens',
    clientIdEnv: 'ZENDESK_CLIENT_ID',
    clientSecretEnv: 'ZENDESK_CLIENT_SECRET',
  },
  intercom: {
    tokenUrl: 'https://api.intercom.io/auth/eagle/token',
    clientIdEnv: 'INTERCOM_CLIENT_ID',
    clientSecretEnv: 'INTERCOM_CLIENT_SECRET',
  },
  pipedrive: {
    tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
    clientIdEnv: 'PIPEDRIVE_CLIENT_ID',
    clientSecretEnv: 'PIPEDRIVE_CLIENT_SECRET',
  },
  zoho: {
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    clientIdEnv: 'ZOHO_CLIENT_ID',
    clientSecretEnv: 'ZOHO_CLIENT_SECRET',
  },
  sellsy: {
    tokenUrl: 'https://login.sellsy.com/oauth2/token',
    clientIdEnv: 'SELLSY_CLIENT_ID',
    clientSecretEnv: 'SELLSY_CLIENT_SECRET',
  },
  zoom: {
    tokenUrl: 'https://zoom.us/oauth/token',
    clientIdEnv: 'ZOOM_CLIENT_ID',
    clientSecretEnv: 'ZOOM_CLIENT_SECRET',
  }
};

export default async function handler(req, res) {
  // Configurer les en-têtes CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { code, state, error: oauthError, error_description } = req.query;

  // 1. Décodage du state pour retrouver le contexte utilisateur
  let stateData = null;
  try {
    if (state) {
      const decoded = Buffer.from(state, 'base64').toString('utf-8');
      stateData = JSON.parse(decoded);
    }
  } catch (e) {
    console.error('[OAuth Callback] Erreur lors du décodage du state :', e);
  }

  const userId = stateData?.userId;
  const agentId = stateData?.agentId;
  const connector = stateData?.connector;
  const domain = stateData?.domain;
  const codeVerifier = stateData?.code_verifier;

  if (oauthError || error_description) {
    console.error('[OAuth Callback] Erreur d\'autorisation :', oauthError, error_description);
    return renderHTMLResponse(res, false, `Erreur d'autorisation de la plateforme partenaire : ${error_description || oauthError}`, agentId, connector);
  }

  if (!code || !stateData || !userId || !agentId || !connector) {
    return renderHTMLResponse(res, false, "Paramètres OAuth manquants ou invalides dans la requête de retour.", agentId, connector);
  }

  // 2. Détection du fournisseur OAuth
  const connLower = connector.toLowerCase();
  let providerKey = '';
  for (const key of Object.keys(OAUTH_PROVIDERS)) {
    if (connLower.includes(key)) {
      providerKey = key;
      break;
    }
  }

  // Fallback spécifiques ou aliases
  if (!providerKey) {
    if (connLower.includes('sheets') || connLower.includes('drive') || connLower.includes('gmail') || connLower.includes('youtube') || connLower.includes('bigquery') || connLower.includes('gcp') || connLower.includes('gcalendar')) {
      providerKey = 'google';
    } else if (connLower.includes('x/twitter') || connLower.includes('x/')) {
      providerKey = 'twitter';
    } else if (connLower.includes('facebook') || connLower.includes('instagram')) {
      providerKey = 'meta';
    } else if (connLower.includes('jira') || connLower.includes('confluence') || connLower.includes('trello')) {
      providerKey = 'atlassian';
    } else if (connLower.includes('teams') || connLower.includes('onedrive') || connLower.includes('sharepoint')) {
      providerKey = 'microsoft';
    } else if (connLower.includes('woocommerce')) {
      providerKey = 'wordpress';
    }
  }

  const providerConfig = OAUTH_PROVIDERS[providerKey];
  if (!providerConfig) {
    return renderHTMLResponse(res, false, `Le connecteur "${connector}" n'est pas répertorié ou ne supporte pas l'authentification OAuth 2.0 directe.`, agentId, connector);
  }

  const clientId = process.env[providerConfig.clientIdEnv];
  const clientSecret = process.env[providerConfig.clientSecretEnv];

  // Si l'administrateur n'a pas configuré les variables sur Vercel, on affiche un message clair
  if (!clientId || !clientSecret) {
    return renderHTMLResponse(res, false, `Configuration manquante sur Vercel :<br>Veuillez définir les variables d'environnement <strong>${providerConfig.clientIdEnv}</strong> et <strong>${providerConfig.clientSecretEnv}</strong> dans votre console d'administration Vercel.`, agentId, connector, true, providerConfig.clientIdEnv, providerConfig.clientSecretEnv);
  }

  // 3. Échange de jetons
  try {
    const appUrl = process.env.APP_URL || 'https://plateforme-agents-ia.vercel.app';
    const redirectUri = `${appUrl}/api/oauth-callback`;

    let tokenUrl = providerConfig.tokenUrl;
    if (domain) {
      // Pour Zendesk et Shopify qui nécessitent des sous-domaines dynamiques
      tokenUrl = tokenUrl.replace('{shop}', domain).replace('{subdomain}', domain);
    }

    // Préparer les paramètres et en-têtes de la requête
    let headers = {
      'Accept': 'application/json'
    };
    let bodyPayload;

    const isNotion = providerKey === 'notion';
    const isAirtable = providerKey === 'airtable';
    const isCanva = providerKey === 'canva';
    // X/Twitter's token endpoint requires confidential clients to authenticate via HTTP Basic
    // auth (client_id:client_secret) — sending them as body params instead (the generic branch
    // below) gets rejected with "Missing valid authorization header".
    const isTwitter = providerKey === 'twitter';

    if (isNotion || isAirtable || isCanva || isTwitter) {
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      headers['Authorization'] = `Basic ${authHeader}`;
      
      if (isNotion) {
        headers['Content-Type'] = 'application/json';
        bodyPayload = JSON.stringify({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri
        });
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        params.append('code_verifier', codeVerifier || 'challenge');
        bodyPayload = params.toString();
      }
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', redirectUri);
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      bodyPayload = params.toString();
    }

    // Effectuer l'appel POST d'échange de code
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: headers,
      body: bodyPayload
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('[OAuth Callback] Échec de l\'échange de jeton :', tokenData);
      // Certains partenaires (ex: Crisp) renvoient error/error_description sous forme de booléen
      // plutôt qu'un texte descriptif — dans ce cas on ignore ces champs pour afficher un message
      // exploitable au lieu de la valeur "true" brute.
      const partnerErrorMsg =
        (typeof tokenData.error_description === 'string' && tokenData.error_description) ||
        (typeof tokenData.error === 'string' && tokenData.error) ||
        tokenData.message ||
        tokenData.reason ||
        JSON.stringify(tokenData);
      return renderHTMLResponse(res, false, `Échec de la validation de connexion auprès du partenaire : ${partnerErrorMsg}`, agentId, connector);
    }

    // 4. Stockage des identifiants dans Supabase
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
    
    if (!supabaseUrl || !supabaseKey) {
      return renderHTMLResponse(res, false, "Configuration de base de données Supabase manquante sur le serveur.", agentId, connector);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user exists and has adopted the agent (or is admin)
    let isAdmin = false;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin,email')
        .eq('id', userId)
        .single();
        
      if (profile) {
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
        const isAdminEmail = profile.email && adminEmails.includes(profile.email.trim().toLowerCase());
        isAdmin = profile.is_admin || isAdminEmail;
      }
    } catch (e) {
      console.warn('[OAuth Callback] Error checking profile:', e);
    }
    
    if (!isAdmin) {
      const { data: adoption, error: adoptErr } = await supabase
        .from('adopted_agents')
        .select('*')
        .eq('user_id', userId)
        .eq('agent_id', agentId)
        .single();
        
      if (adoptErr || !adoption) {
        return renderHTMLResponse(res, false, "Vous devez adopter cet agent avant de pouvoir y associer ce connecteur.", agentId, connector);
      }
    }

    // Structurer les identifiants
    const isSlack = connector.toLowerCase().includes('slack');
    const credentials = {
      token: (isSlack && tokenData.incoming_webhook) ? tokenData.incoming_webhook.url : tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresIn: tokenData.expires_in || null,
      scope: tokenData.scope || null,
      connectedAt: new Date().toISOString(),
      userAccount: tokenData.user_id || tokenData.email || 'Compte vérifié'
    };

    if (isSlack && tokenData.incoming_webhook) {
      credentials.botToken = tokenData.access_token;
      credentials.webhookUrl = tokenData.incoming_webhook.url;
      credentials.channel = tokenData.incoming_webhook.channel;
    }

    if (domain) credentials.domain = domain;

    const { error: dbError } = await supabase
      .from('connectors')
      .upsert({
        user_id: userId,
        agent_id: agentId,
        connector_name: connector,
        credentials: credentials
      }, {
        onConflict: 'user_id,agent_id,connector_name'
      });

    if (dbError) {
      console.error('[OAuth Callback] Erreur lors de la sauvegarde dans Supabase :', dbError);
      return renderHTMLResponse(res, false, `Sauvegarde impossible de la liaison sur Supabase : ${dbError.message}`, agentId, connector);
    }

    return renderHTMLResponse(res, true, `La liaison avec <strong>${connector}</strong> est validée officiellement avec succès ! 🚀`, agentId, connector);
  } catch (error) {
    console.error('[OAuth Callback] Erreur interne :', error);
    return renderHTMLResponse(res, false, `Erreur réseau ou technique interne : ${error.message || error}`, agentId, connector);
  }
}

// Fonction utilitaire pour générer une page de retour HTML propre, animée avec esthétique premium
function renderHTMLResponse(res, success, message, agentId, connector, isConfigError = false, var1 = '', var2 = '') {
  const statusClass = success ? 'success' : 'error';
  const statusIcon = success ? '✅' : '❌';
  const statusTitle = success ? 'CONNEXION RÉUSSIE !' : 'ÉCHEC DE LA CONNEXION';
  const redirectUrl = `/?oauth_status=${statusClass}&agent_id=${agentId || ''}&connector=${encodeURIComponent(connector || '')}`;

  const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Liaison César-IA</title>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #09090b;
          --card-bg: #121214;
          --text: #ffffff;
          --text-muted: #a1a1aa;
          --success: #10b981;
          --error: #ef4444;
          --accent: #a855f7;
        }
        body {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          background: var(--bg);
          color: var(--text);
          font-family: 'Plus Jakarta Sans', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          overflow: hidden;
        }
        .container {
          width: 100%;
          max-width: 460px;
          padding: 40px 24px;
          margin: 16px;
          background: var(--card-bg);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
          text-align: center;
          position: relative;
          z-index: 1;
        }
        .icon {
          font-size: 3rem;
          margin-bottom: 24px;
          filter: drop-shadow(0 0 15px rgba(255,255,255,0.1));
        }
        h2 {
          font-size: 1.35rem;
          font-weight: 800;
          letter-spacing: -0.5px;
          margin: 0 0 12px 0;
          color: ${success ? 'var(--success)' : 'var(--error)'};
        }
        p {
          font-size: 0.88rem;
          color: var(--text-muted);
          line-height: 1.55;
          margin: 0 0 28px 0;
        }
        .btn {
          display: block;
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
          color: #fff;
          font-weight: 700;
          font-size: 0.9rem;
          text-decoration: none;
          cursor: pointer;
          border: none;
          box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3);
          transition: transform 0.2s, opacity 0.2s;
        }
        .btn:hover {
          transform: translateY(-2px);
          opacity: 0.95;
        }
        .config-box {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 14px;
          font-family: monospace;
          font-size: 0.76rem;
          text-align: left;
          color: #fff;
          margin-bottom: 20px;
        }
        .config-title {
          font-weight: bold;
          color: var(--accent);
          margin-bottom: 6px;
        }
        .glow {
          position: absolute;
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(168,85,247,0.1) 0%, rgba(0,0,0,0) 70%);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 0;
          pointer-events: none;
        }
      </style>
    </head>
    <body>
      <div class="glow"></div>
      <div class="container">
        <div class="icon">${statusIcon}</div>
        <h2>${statusTitle}</h2>
        <p>${message}</p>
        
        ${isConfigError ? `
          <div class="config-box">
            <div class="config-title">🛠️ Variables à ajouter sur Vercel :</div>
            <code>- Key: ${var1}<br>- Key: ${var2}</code>
          </div>
        ` : ''}

        <a class="btn" href="${redirectUrl}">Retourner au tableau de bord</a>
      </div>
      
      <script>
        // Rediriger automatiquement vers l'application après 4 secondes si succès
        if (${success}) {
          setTimeout(function() {
            window.location.href = "${redirectUrl}";
          }, 3500);
        }
      </script>
    </body>
    </html>
  `;
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(success ? 200 : 400).send(html);
}
