import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (!supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL'))
  ? null
  : createClient(supabaseUrl, supabaseKey);

function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const PROVIDERS_AUTH = {
  canva: {
    authUrl: 'https://www.canva.com/api/oauth/authorize',
    clientIdEnv: 'CANVA_CLIENT_ID',
    scopes: 'design:content:read design:content:write profile:read',
    pkce: true
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    scopes: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/youtube',
    extraParams: { access_type: 'offline', prompt: 'consent' }
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    scopes: 'w_member_social openid profile email'
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    clientIdEnv: 'SLACK_CLIENT_ID',
    scopes: 'incoming-webhook chat:write chat:write.public channels:read'
  },
  twitter: {
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    clientIdEnv: 'TWITTER_CLIENT_ID',
    scopes: 'tweet.read tweet.write users.read offline.access',
    pkce: true
  },
  meta: {
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    clientIdEnv: 'META_CLIENT_ID',
    scopes: 'email pages_show_list pages_read_engagement pages_manage_posts instagram_basic instagram_content_publish'
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    scopes: 'repo user admin:repo_hook'
  },
  hubspot: {
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    clientIdEnv: 'HUBSPOT_CLIENT_ID',
    scopes: 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write'
  },
  salesforce: {
    authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    clientIdEnv: 'SALESFORCE_CLIENT_ID'
  },
  airtable: {
    authUrl: 'https://airtable.com/oauth2/v1/authorize',
    clientIdEnv: 'AIRTABLE_CLIENT_ID',
    scopes: 'data.records:read data.records:write schema.bases:read',
    pkce: true
  },
  buffer: {
    authUrl: 'https://api.bufferapp.com/1/oauth2/authorize.json',
    clientIdEnv: 'BUFFER_CLIENT_ID'
  },
  pinterest: {
    authUrl: 'https://www.pinterest.com/oauth/',
    clientIdEnv: 'PINTEREST_CLIENT_ID',
    scopes: 'boards:read boards:write pins:read pins:write'
  },
  notion: {
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    clientIdEnv: 'NOTION_CLIENT_ID',
    extraParams: { owner: 'user' }
  },
  asana: {
    authUrl: 'https://app.asana.com/-/oauth_authorize',
    clientIdEnv: 'ASANA_CLIENT_ID'
  },
  monday: {
    authUrl: 'https://auth.monday.com/oauth2/authorize',
    clientIdEnv: 'MONDAY_CLIENT_ID',
    scopes: 'me:read boards:read boards:write'
  },
  clickup: {
    authUrl: 'https://app.clickup.com/api',
    clientIdEnv: 'CLICKUP_CLIENT_ID'
  },
  discord: {
    authUrl: 'https://discord.com/api/oauth2/authorize',
    clientIdEnv: 'DISCORD_CLIENT_ID',
    scopes: 'identify email connections'
  },
  atlassian: {
    authUrl: 'https://auth.atlassian.com/authorize',
    clientIdEnv: 'ATLASSIAN_CLIENT_ID',
    scopes: 'read:jira-work write:jira-work read:confluence-content write:confluence-content',
    extraParams: { audience: 'api.atlassian.com', prompt: 'consent' }
  },
  gitlab: {
    authUrl: 'https://gitlab.com/oauth/authorize',
    clientIdEnv: 'GITLAB_CLIENT_ID',
    scopes: 'api read_user'
  },
  bitbucket: {
    authUrl: 'https://bitbucket.org/site/oauth2/authorize',
    clientIdEnv: 'BITBUCKET_CLIENT_ID'
  },
  box: {
    authUrl: 'https://account.box.com/api/oauth2/authorize',
    clientIdEnv: 'BOX_CLIENT_ID'
  },
  stripe: {
    authUrl: 'https://connect.stripe.com/oauth/authorize',
    clientIdEnv: 'STRIPE_CLIENT_ID',
    scopes: 'read_write'
  },
  paypal: {
    authUrl: 'https://www.paypal.com/signin/authorize',
    clientIdEnv: 'PAYPAL_CLIENT_ID',
    scopes: 'openid email'
  },
  webflow: {
    authUrl: 'https://webflow.com/oauth/authorize',
    clientIdEnv: 'WEBFLOW_CLIENT_ID'
  },
  shopify: {
    authUrl: 'https://{shop}/admin/oauth/authorize',
    clientIdEnv: 'SHOPIFY_CLIENT_ID',
    scopes: 'read_products,write_products,read_orders,write_orders'
  },
  wordpress: {
    authUrl: 'https://public-api.wordpress.com/oauth2/authorize',
    clientIdEnv: 'WORDPRESS_CLIENT_ID',
    scopes: 'posts'
  },
  crisp: {
    authUrl: 'https://app.crisp.chat/oauth/authorize',
    clientIdEnv: 'CRISP_CLIENT_ID'
  },
  zendesk: {
    authUrl: 'https://{shop}/oauth/authorizations/new',
    clientIdEnv: 'ZENDESK_CLIENT_ID',
    scopes: 'read write'
  },
  intercom: {
    authUrl: 'https://app.intercom.com/oauth',
    clientIdEnv: 'INTERCOM_CLIENT_ID'
  },
  pipedrive: {
    authUrl: 'https://oauth.pipedrive.com/oauth/authorize',
    clientIdEnv: 'PIPEDRIVE_CLIENT_ID',
    scopes: 'deals:read deals:write contacts:read contacts:write'
  },
  zoho: {
    authUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    clientIdEnv: 'ZOHO_CLIENT_ID',
    scopes: 'ZohoCRM.modules.all ZohoCRM.users.all',
    extraParams: { access_type: 'offline', prompt: 'consent' }
  },
  sellsy: {
    authUrl: 'https://login.sellsy.com/oauth2/authorization',
    clientIdEnv: 'SELLSY_CLIENT_ID'
  },
  zoom: {
    authUrl: 'https://zoom.us/oauth/authorize',
    clientIdEnv: 'ZOOM_CLIENT_ID'
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { userId, agentId, connector, domain } = req.query;

  if (!userId || !agentId || !connector) {
    return res.status(400).json({ error: 'userId, agentId et connector requis.' });
  }

  // Security Verification: Require authenticated user who has adopted the agent
  const isLocalMock = !supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL');
  if (!isLocalMock && supabase) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          return res.status(401).json({ error: "Session expirée ou invalide. Veuillez vous reconnecter." });
        }
        if (user.id !== userId) {
          return res.status(403).json({ error: "Accès refusé. L'identifiant utilisateur ne correspond pas." });
        }

        // Check if admin (ASCII, accented, and punycode variations)
        const adminEmails = [
          'contact@cesar-ia.com',
          'admin@cesar-ia.com',
          'contact@césar-ia.com',
          'admin@césar-ia.com',
          'contact@xn--csar-ia-bya.com',
          'admin@xn--csar-ia-bya.com'
        ];
        const isAdminEmail = user.email && adminEmails.includes(user.email.trim().toLowerCase());
        
        let isAdminProfile = false;
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .single();
          if (profile) {
            isAdminProfile = profile.is_admin;
          }
        } catch (e) {}
        
        const isAdmin = isAdminEmail || isAdminProfile;

        if (!isAdmin) {
          // Verify agent adoption
          const { data: adoption, error: adoptErr } = await supabase
            .from('adopted_agents')
            .select('*')
            .eq('user_id', user.id)
            .eq('agent_id', agentId)
            .single();
            
          if (adoptErr || !adoption) {
            return res.status(403).json({ error: "Vous devez adopter cet agent avant de pouvoir lier un connecteur." });
          }
        }
      } catch (err) {
        return res.status(401).json({ error: `Erreur d'authentification : ${err.message}` });
      }
    } else {
      return res.status(401).json({ error: "Authentification requise pour cette opération." });
    }
  }

  // 1. Détection du fournisseur
  const connLower = connector.toLowerCase();
  let providerKey = '';
  for (const key of Object.keys(PROVIDERS_AUTH)) {
    if (connLower.includes(key)) {
      providerKey = key;
      break;
    }
  }

  // Aliases
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

  const config = PROVIDERS_AUTH[providerKey];
  if (!config) {
    return res.status(400).json({ error: `Le connecteur ${connector} ne supporte pas l'intégration OAuth2 directe.` });
  }

  const clientId = process.env[config.clientIdEnv];
  if (!clientId) {
    // Si la clé n'est pas encore configurée sur Vercel, on retourne une erreur explicite que le front interceptera
    return res.status(400).json({ 
      error: 'missing_config', 
      message: `La variable d'environnement ${config.clientIdEnv} n'est pas encore configurée sur Vercel.` 
    });
  }

  // 2. Construction de l'URL OAuth
  const appUrl = process.env.APP_URL || 'https://plateforme-agents-ia.vercel.app';
  const redirectUri = `${appUrl}/api/oauth-callback`;

  const urlParams = new URLSearchParams();
  urlParams.append('response_type', 'code');
  urlParams.append('client_id', clientId);
  urlParams.append('redirect_uri', redirectUri);

  // Préparer le state sécurisé en Base64
  const statePayloadData = {
    userId,
    agentId,
    connector,
    domain: domain || null
  };

  if (config.pkce) {
    const { verifier, challenge } = generatePkce();
    statePayloadData.code_verifier = verifier;
    urlParams.append('code_challenge', challenge);
    urlParams.append('code_challenge_method', 'S256');
  }

  const statePayload = Buffer.from(JSON.stringify(statePayloadData)).toString('base64');
  urlParams.append('state', statePayload);

  if (config.scopes) {
    urlParams.append('scope', config.scopes);
  }

  // Ajouter les paramètres spécifiques requis
  if (config.extraParams) {
    for (const [pk, pv] of Object.entries(config.extraParams)) {
      urlParams.append(pk, pv);
    }
  }

  let baseAuthUrl = config.authUrl;
  if (domain) {
    baseAuthUrl = baseAuthUrl.replace('{shop}', domain).replace('{subdomain}', domain);
  }

  const finalUrl = `${baseAuthUrl}?${urlParams.toString()}`;

  return res.status(200).json({ url: finalUrl });
}
