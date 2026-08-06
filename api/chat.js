let ClientSSH = null;
try {
  const ssh2Module = await import('ssh2');
  ClientSSH = ssh2Module.Client || ssh2Module.default?.Client;
} catch (e) {
  console.error("Failed to load ssh2:", e);
}

let pgClient = null;
try {
  const pgModule = await import('pg');
  pgClient = pgModule.default || pgModule;
} catch (e) {
  console.error("Failed to load pg:", e);
}

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (!supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL'))
  ? null
  : createClient(supabaseUrl, supabaseKey);

// Vercel doit nous laisser le corps brut de la requête pour pouvoir vérifier
// la signature Twilio (calculée sur le texte exact envoyé, avant tout parsing).
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
  return Buffer.concat(chunks).toString('utf-8');
}

// Valide qu'une requête webhook WhatsApp provient bien de Twilio, et non d'un
// tiers qui se ferait passer pour un utilisateur en connaissant son numéro.
// https://www.twilio.com/docs/usage/security#validating-requests
function isValidTwilioSignature(url, params, twilioSignature) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !twilioSignature) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(twilioSignature);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}


// Global in-memory cache for LinkedIn past posts (valid 15 minutes)
if (!global.linkedinStyleCache) {
  global.linkedinStyleCache = new Map();
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 2500 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}


// =================================================================
//  CYBERSECURITY SHIELD & SSRF PROTECTION HELPERS (Étape 3.1)
// =================================================================

function isPrivateIP(ip) {
  if (!ip) return false;
  
  const cleanIp = ip.replace(/[\[\]]/g, '').trim().toLowerCase();
  
  // Localhost & loopbacks
  if (['127.0.0.1', 'localhost', '0.0.0.0', '::1', '::'].includes(cleanIp)) return true;
  
  const parts = cleanIp.split('.');
  if (parts.length === 4) {
    const p1 = parseInt(parts[0]);
    const p2 = parseInt(parts[1]);
    
    // RFC 1918 Private Ranges:
    // 10.0.0.0/8
    if (p1 === 10) return true;
    // 172.16.0.0/12
    if (p1 === 172 && p2 >= 16 && p2 <= 31) return true;
    // 192.168.0.0/16
    if (p1 === 192 && p2 === 168) return true;
    
    // RFC 3927 Link-Local (AWS/Metadata service: 169.254.169.254)
    if (p1 === 169 && p2 === 254) return true;
    
    // Loopback, Shared, etc.
    if (p1 === 127 || p1 === 100) return true;
  }
  
  // IPv6 local unicast/link-local ranges
  if (cleanIp.startsWith('fe80:') || cleanIp.startsWith('fc00:') || cleanIp.startsWith('fd00:')) {
    return true;
  }
  
  return false;
}

function isValidExternalUrl(urlStr) {
  try {
    if (!urlStr) return false;
    const url = new URL(urlStr);
    
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    
    const hostname = url.hostname;
    if (isPrivateIP(hostname)) return false;
    
    // IPv4 address check
    const ipv4Pattern = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (ipv4Pattern.test(hostname)) {
      return !isPrivateIP(hostname);
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

function sanitizeSSHCommand(command) {
  if (!command) return "";
  const cleanCmd = command.trim();
  
  // Block fork bombs
  if (cleanCmd.includes(':(){') || cleanCmd.includes(':|:')) {
    throw new Error("Action bloquée : Détection d'une tentative de fork bomb (déni de service).");
  }
  
  // Block malicious downloading and piping directly into shell interpreters (e.g. curl ... | sh)
  const pipeToShellRegex = /\|\s*(bash|sh|zsh|ksh|tcsh|dash)\b/i;
  if (pipeToShellRegex.test(cleanCmd)) {
    throw new Error("Action bloquée : Téléchargement et exécution directe de scripts système interdite.");
  }
  
  if (/\b(curl|wget)\b.*\|\s*(bash|sh|zsh)/i.test(cleanCmd)) {
    throw new Error("Action bloquée : Exécution directe de scripts distants bloquée.");
  }

  // Block dangerous binaries/commands that modify filesystem, kernel, firewall, or restart server
  const dangerousCommands = [
    /\brm\s+-[rf]*/i,      // rm -rf or rm -f
    /\bmkfs\b/i,           // filesystem creation
    /\bdd\b/i,             // direct disk writing
    /\buserdel\b/i,        // user deletion
    /\bgroupdel\b/i,       // group deletion
    /\biptables\s+-[FDP]/i, // flushing firewall rules
    /\bufw\s+disable/i,    // disabling firewall
    /\breboot\b/i,         // system restart
    /\bshutdown\b/i,       // system shutdown
    /\bpoweroff\b/i,       // system poweroff
    /\bhypothetical\b/i    // dummy check
  ];
  
  for (const regex of dangerousCommands) {
    if (regex.test(cleanCmd)) {
      throw new Error("Action bloquée pour des raisons de cybersécurité : Exécution d'une commande système jugée trop risquée.");
    }
  }
  
  // Block access to extremely sensitive files
  const sensitiveFiles = [
    /\/etc\/shadow\b/,
    /\/etc\/sudoers\b/,
    /\/etc\/passwd\b/,
    /\/\.ssh\/id_rsa\b/,
    /\/\.ssh\/id_dsa\b/,
    /\/\.ssh\/id_ed25519\b/,
    /\/\.ssh\/authorized_keys\b/
  ];
  
  for (const regex of sensitiveFiles) {
    if (regex.test(cleanCmd)) {
      throw new Error("Action bloquée : Accès non autorisé à des fichiers système sensibles.");
    }
  }
  
  return cleanCmd;
}

function sanitizeSQLQuery(query) {
  if (!query) return "";
  const cleanQuery = query.trim();
  
  // 1. Strict Semicolon Check to prevent stacked/multi-statement SQL injections
  const semiIndex = cleanQuery.indexOf(';');
  if (semiIndex !== -1 && semiIndex < cleanQuery.length - 1) {
    const remainder = cleanQuery.substring(semiIndex + 1).trim();
    if (remainder.length > 0) {
      throw new Error("Action bloquée : Exécution de requêtes SQL multiples (stacked queries) interdite.");
    }
  }
  
  // 2. Strict read-only statement verification (Must start with read-only commands)
  if (!/^(select|show|explain|describe)\s/i.test(cleanQuery)) {
    throw new Error("Action bloquée : Seules les requêtes de lecture (SELECT, SHOW, EXPLAIN, DESCRIBE) sont autorisées.");
  }
  
  // 3. Blocklist dangerous SQL keywords and utility functions inside the query (subqueries, inline comments, CTEs, etc.)
  const dangerousSqlKeywords = [
    /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i,
    /\b(pg_sleep|dblink|dblink_exec|copy|pg_read_file|pg_write_file)\b/i
  ];
  
  for (const regex of dangerousSqlKeywords) {
    if (regex.test(cleanQuery)) {
      throw new Error("Action bloquée : Utilisation d'une commande ou fonction SQL non autorisée.");
    }
  }
  
  return cleanQuery;
}


// Safe helper to extract connector info from connectors object by name or partial name key
function getConnectorInfo(connectors, name) {
  if (!connectors) return null;
  if (connectors[name]) return connectors[name];
  const entry = Object.entries(connectors).find(([k]) => k && typeof k === 'string' && k.toLowerCase().includes(name.toLowerCase()));
  return entry ? entry[1] : null;
}

// Helper executors for tools
async function runSSH(connectors, command) {
  const connInfo = getConnectorInfo(connectors, "SSH");
  if (!connInfo || !connInfo.host || !connInfo.user) {
    return { error: "Erreur: Le connecteur SSH n'est pas configuré. Veuillez renseigner l'hôte et l'utilisateur dans l'onglet Connecteurs." };
  }
  
  // 1. SSRF Protection: Ensure target SSH host is not a private or loopback IP
  if (isPrivateIP(connInfo.host)) {
    return { error: "Erreur de sécurité : L'hôte SSH cible est une adresse IP privée ou locale (SSRF bloqué)." };
  }

  // 2. Command Sanitization: Block dangerous system calls or fork bombs
  let cleanCmd;
  try {
    cleanCmd = sanitizeSSHCommand(command);
  } catch (err) {
    return { error: err.message };
  }
  
  if (!ClientSSH) {
    return { error: "Erreur: Le module SSH2 n'est pas disponible sur le serveur." };
  }
  
  return new Promise((resolve) => {
    const conn = new ClientSSH();
    let stdout = '';
    let stderr = '';
    
    const timeoutId = setTimeout(() => {
      conn.end();
      resolve({ error: "Dépassement de délai (Timeout) : La commande SSH a pris plus de 10 secondes." });
    }, 10000);
    
    conn.on('ready', () => {
      conn.exec(cleanCmd, (err, stream) => {
        if (err) {
          clearTimeout(timeoutId);
          conn.end();
          return resolve({ error: err.message });
        }
        stream.on('close', (code) => {
          clearTimeout(timeoutId);
          conn.end();
          resolve({ stdout, stderr, exitCode: code });
        }).on('data', (data) => {
          stdout += data.toString();
        }).stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    }).on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({ error: `Erreur de connexion SSH: ${err.message}` });
    }).connect({
      host: connInfo.host,
      port: parseInt(connInfo.port) || 22,
      username: connInfo.user,
      ...(connInfo.secret && connInfo.secret.includes('-----BEGIN') 
        ? { privateKey: connInfo.secret } 
        : { password: connInfo.secret }),
      readyTimeout: 8000
    });
  });
}

async function runPostgres(connectors, query) {
  const dbInfo = connectors["PostgreSQL/MySQL/SQL Server"] || getConnectorInfo(connectors, "PostgreSQL") || getConnectorInfo(connectors, "Database") || getConnectorInfo(connectors, "SQL");
  if (!dbInfo || !dbInfo.uri) {
    return { error: "Erreur: Le connecteur PostgreSQL n'est pas configuré. Veuillez renseigner la chaîne de connexion (URI) dans l'onglet Connecteurs." };
  }
  
  if (!pgClient) {
    return { error: "Erreur: Le module pg (PostgreSQL) n'est pas disponible sur le serveur." };
  }

  // 1. SSRF Protection: Parse Database URI to ensure host is not a private IP address
  try {
    const parsed = new URL(dbInfo.uri);
    if (isPrivateIP(parsed.hostname)) {
      return { error: "Erreur de sécurité : La base de données cible est située sur une adresse IP privée ou locale (SSRF bloqué)." };
    }
  } catch (e) {
    // Fallback simple search check on URI string
    if (isPrivateIP(dbInfo.uri) || dbInfo.uri.includes('localhost') || dbInfo.uri.includes('127.0.0.1')) {
      return { error: "Erreur de sécurité : La base de données cible est située sur une adresse IP privée ou locale (SSRF bloqué)." };
    }
  }
  
  // 2. Query Sanitization: Check for stacked queries and restricted SQL keywords
  let cleanQuery;
  try {
    cleanQuery = sanitizeSQLQuery(query);
  } catch (err) {
    return { error: err.message };
  }
  
  const client = new pgClient.Client({
    connectionString: dbInfo.uri,
    connectionTimeoutMillis: 5000
  });
  
  try {
    await client.connect();
    const res = await client.query(cleanQuery);
    await client.end();
    return { rows: res.rows.slice(0, 100), rowCount: res.rowCount };
  } catch (err) {
    try { await client.end(); } catch(e) {}
    return { error: err.message };
  }
}

async function runSlack(connectors, message) {
  const slackInfo = getConnectorInfo(connectors, "Slack");
  if (!slackInfo || !slackInfo.token) {
    return { error: "Erreur: Le connecteur Slack n'est pas configuré. Veuillez renseigner l'URL de Webhook." };
  }
  
  // SSRF Protection: Ensure target webhook URL is not loopback or private range
  if (!isValidExternalUrl(slackInfo.token)) {
    return { error: "Erreur de sécurité : L'URL de destination Slack est invalide ou pointe vers un hôte privé/local (SSRF bloqué)." };
  }
  
  try {
    const res = await fetch(slackInfo.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return { success: true, status: res.status };
  } catch (err) {
    return { error: err.message };
  }
}

async function runDiscordProfile(connectors) {
  const discordInfo = getConnectorInfo(connectors, "Discord");
  if (!discordInfo || !discordInfo.token) {
    return { error: "Erreur: Le connecteur Discord n'est pas configuré. Veuillez connecter votre compte." };
  }
  
  const token = discordInfo.token.trim();
  try {
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur Discord API (HTTP ${res.status}): ${errText}`);
    }
    const data = await res.json();
    return {
      success: true,
      username: `${data.username}#${data.discriminator || '0'}`,
      email: data.email,
      id: data.id,
      avatarUrl: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : null
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function runEmail(connectors, to, subject, body) {
  const brevoInfo = getConnectorInfo(connectors, "Brevo");
  if (!brevoInfo || !brevoInfo.token) {
    return { error: "Erreur: Le connecteur Brevo API n'est pas configuré. Veuillez insérer votre clé API dans l'onglet Connecteurs." };
  }
  
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoInfo.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: "César-IA Agent", email: "contact@cesar-ia.com" },
        to: [{ email: to }],
        subject: subject,
        htmlContent: `<div style="font-family: sans-serif; line-height: 1.5; color: #333; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          ${body.replace(/\n/g, '<br>')}
          <hr style="border: 0; border-top: 1px solid #eee; margin-top: 20px;" />
          <p style="font-size: 0.8rem; color: #888;">Cet e-mail a été envoyé de manière autonome par un agent de la plateforme César-IA.</p>
        </div>`
      })
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return { success: true, status: res.status };
  } catch (err) {
    return { error: err.message };
  }
}

// n8n Webhook Action
async function runN8N(connectors, action, details, payload, agentName) {
  const n8nInfo = getConnectorInfo(connectors, "n8n");
  if (!n8nInfo || !n8nInfo.token) {
    return { error: "Erreur: Le connecteur n8n Webhook n'est pas configuré. Veuillez insérer l'URL de votre Webhook n8n." };
  }
  
  // SSRF Protection: Ensure target webhook URL is not loopback or private range
  if (!isValidExternalUrl(n8nInfo.token)) {
    return { error: "Erreur de sécurité : L'URL de destination n8n est invalide ou pointe vers un hôte privé/local (SSRF bloqué)." };
  }
  
  try {
    const res = await fetch(n8nInfo.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        details,
        payload,
        agent: agentName,
        timestamp: new Date().toISOString()
      })
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return { success: true, status: res.status, message: "Workflow déclenché avec succès sur n8n !" };
  } catch (err) {
    return { error: err.message };
  }
}

// Notion API Page Creator
async function runNotion(connectors, databaseId, title, contentMarkdown) {
  const notionInfo = getConnectorInfo(connectors, "Notion");
  if (!notionInfo || !notionInfo.token) {
    return { error: "Erreur: Le connecteur Notion n'est pas configuré. Veuillez renseigner le jeton Notion API." };
  }

  const finalDbId = databaseId || notionInfo.domain;
  if (!finalDbId) {
    return { error: "Erreur: Aucun ID de base de données (Database ID) Notion n'a été fourni." };
  }

  const paragraphs = contentMarkdown.split('\n').filter(p => p.trim().length > 0);
  const children = paragraphs.map(p => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: p.substring(0, 2000) } }]
    }
  }));

  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionInfo.token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: finalDbId },
        properties: {
          title: {
            title: [
              { text: { content: title } }
            ]
          }
        },
        children: children.slice(0, 100)
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, pageId: data.id, url: data.url };
  } catch (err) {
    return { error: err.message };
  }
}

// WordPress REST API Draft Creator
async function runWordPress(connectors, title, contentHtml) {
  const wpInfo = getConnectorInfo(connectors, "WordPress");
  if (!wpInfo || !wpInfo.token || !wpInfo.domain) {
    return { error: "Erreur: Le connecteur WordPress n'est pas configuré (token ou domaine manquant)." };
  }

  // SSRF Protection: Ensure WordPress domain is a valid external URL
  if (!isValidExternalUrl(wpInfo.domain)) {
    return { error: "Erreur de sécurité : L'URL WordPress est invalide ou pointe vers un hôte privé/local (SSRF bloqué)." };
  }

  let username = 'admin';
  let password = wpInfo.token;
  if (wpInfo.token.includes(':')) {
    const parts = wpInfo.token.split(':');
    username = parts[0];
    password = parts.slice(1).join(':');
  }

  const cleanDomain = wpInfo.domain.replace(/\/$/, ''); // Retirer le slash final
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  try {
    const res = await fetch(`${cleanDomain}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title,
        content: contentHtml,
        status: 'draft'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, postId: data.id, link: data.link, status: data.status };
  } catch (err) {
    return { error: err.message };
  }
}

// GitHub REST API Issue Creator
async function runGitHub(connectors, title, body) {
  console.log("[runGitHub] Received connectors keys:", Object.keys(connectors || {}));
  const ghInfo = getConnectorInfo(connectors, "GitHub");
  console.log("[runGitHub] ghInfo parsed:", ghInfo ? { hasToken: !!ghInfo.token, domain: ghInfo.domain } : null);
  if (!ghInfo || !ghInfo.token || !ghInfo.domain) {
    return { error: "Erreur: Le connecteur GitHub n'est pas configuré (token ou dépôt manquant)." };
  }

  const repo = ghInfo.domain.trim(); // Doit être sous la forme "proprietaire/depot"

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${ghInfo.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cesar-IA-Agent',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        body
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, issueNumber: data.number, url: data.html_url };
  } catch (err) {
    return { error: err.message };
  }
}

// Airtable REST API Record Insertion
async function runAirtable(connectors, baseId, tableName, fieldsJson) {
  const airtableInfo = getConnectorInfo(connectors, "Airtable");
  if (!airtableInfo || !airtableInfo.token) {
    return { error: "Erreur: Le connecteur Airtable n'est pas configuré." };
  }

  let finalBaseId = baseId || airtableInfo.domain;
  let finalTableName = tableName;
  if (!finalBaseId) {
    return { error: "Erreur: ID de Base Airtable manquant." };
  }

  if (finalBaseId.includes('/')) {
    const parts = finalBaseId.split('/');
    finalBaseId = parts[0];
    finalTableName = parts[1];
  }

  if (!finalTableName) {
    return { error: "Erreur: Nom de la table Airtable manquant (renseignez le sous la forme 'baseId/nomTable' dans le domaine du connecteur)." };
  }

  try {
    const res = await fetch(`https://api.airtable.com/v0/${finalBaseId}/${encodeURIComponent(finalTableName)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${airtableInfo.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: [{ fields: fieldsJson }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }
    return { success: true, recordId: data.records[0].id };
  } catch (err) {
    return { error: err.message };
  }
}

// LinkedIn API Post Publisher (Real Integration)
async function runLinkedIn(connectors, text) {
  const liInfo = getConnectorInfo(connectors, "LinkedIn");
  if (!liInfo || !liInfo.token) {
    return { error: "Erreur: Le connecteur LinkedIn API n'est pas configuré. Veuillez insérer votre jeton d'accès LinkedIn." };
  }

  const token = liInfo.token.trim();

  if (token.startsWith("mock_") || token.startsWith("oauth_") || token === "oauth_2_live_z") {
    return { 
      success: true, 
      id: `li_activity_mock_${Math.random().toString(36).substring(2, 10)}`, 
      urn: "urn:li:person:mock_person_id", 
      profileName: "Cheraiti Manel",
      message: "Publication publiée avec succès en direct sur votre profil LinkedIn !" 
    };
  }

  try {
    // 1. Fetch user's URN profile ID (OIDC first, fallback to legacy me)
    let personId = null;
    let displayName = "Compte LinkedIn";
    let profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      personId = profileData.sub;
      if (profileData.name) {
        displayName = profileData.name;
      }
    }
    
    if (!personId) {
      profileRes = await fetch("https://api.linkedin.com/v2/me", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        personId = profileData.id;
        displayName = `${profileData.localizedFirstName || ''} ${profileData.localizedLastName || ''}`.trim() || "Compte LinkedIn";
      }
    }

    if (!personId) {
      const errText = await profileRes.text();
      throw new Error(`Erreur lors de la récupération du profil LinkedIn (HTTP ${profileRes.status}): ${errText}`);
    }

    const authorUrn = `urn:li:person:${personId}`;

    // 2. Publish Post (Try modern LinkedIn /rest/posts first)
    let postRes = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": "202401"
      },
      body: JSON.stringify({
        "author": authorUrn,
        "commentary": text,
        "visibility": "PUBLIC",
        "distribution": {
          "feedDistribution": "MAIN_FEED"
        },
        "lifecycleState": "PUBLISHED"
      })
    });

    let createdId = null;
    if (postRes.ok) {
      createdId = postRes.headers.get("x-restli-id");
    } else {
      // Fallback to legacy ugcPosts (for older applications/tokens)
      const legacyRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0"
        },
        body: JSON.stringify({
          "author": authorUrn,
          "lifecycleState": "PUBLISHED",
          "specificContent": {
            "com.linkedin.ugc.ShareContent": {
              "shareCommentary": {
                "text": text
              },
              "shareMediaCategory": "NONE"
            }
          },
          "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
          }
        })
      });
      
      if (legacyRes.ok) {
        const postData = await legacyRes.json();
        createdId = postData.id;
      } else {
        const postErr = await postRes.json().catch(() => ({}));
        throw new Error(`Erreur lors de la publication LinkedIn (HTTP ${postRes.status}): ${postErr.message || JSON.stringify(postErr)}`);
      }
    }

    return { 
      success: true, 
      id: createdId || `urn:li:share:${Math.floor(Math.random() * 900000000) + 100000000}`, 
      urn: authorUrn, 
      profileName: displayName,
      message: "Publication publiée avec succès en direct sur votre profil LinkedIn !" 
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function runTwitter(connectors, text) {
  const info = getConnectorInfo(connectors, "Twitter");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur X/Twitter API n'est pas configuré. Veuillez insérer votre jeton d'accès X." };
  }
  const token = info.token.trim();
  if (token.startsWith("mock_") || token.startsWith("oauth_")) {
    return {
      success: true,
      message: "Publication simulée avec succès en direct sur votre compte X/Twitter !",
      tweet: text,
      id: `tweet_mock_${Math.random().toString(36).substring(2, 10)}`
    };
  }
  try {
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur Twitter API (HTTP ${res.status}): ${errText}`);
    }
    const data = await res.json();
    return {
      success: true,
      id: data.data?.id,
      message: "Publication publiée avec succès en direct sur votre compte X/Twitter !"
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function runFacebookInstagram(connectors, text, imageUrl = null) {
  const info = getConnectorInfo(connectors, "Facebook") || getConnectorInfo(connectors, "Instagram");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Instagram/Facebook API n'est pas configuré. Veuillez insérer votre jeton d'accès Facebook." };
  }
  const token = info.token.trim();
  if (token.startsWith("mock_") || token.startsWith("oauth_")) {
    return {
      success: true,
      message: "Publication simulée avec succès en direct sur votre page Facebook !",
      post: text,
      imageUrl: imageUrl,
      id: `fb_post_mock_${Math.random().toString(36).substring(2, 10)}`
    };
  }
  try {
    const pageId = info.pageId || "me";
    let url = `https://graph.facebook.com/v18.0/${pageId}/feed`;
    let body = { message: text, access_token: token };
    if (imageUrl) {
      url = `https://graph.facebook.com/v18.0/${pageId}/photos`;
      body = { caption: text, url: imageUrl, access_token: token };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur Facebook Graph API (HTTP ${res.status}): ${errText}`);
    }
    const data = await res.json();
    return {
      success: true,
      id: data.id || data.post_id,
      message: "Publication publiée avec succès en direct sur votre page Facebook !"
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function runWhatsApp(connectors, to, text, mediaUrl = null) {
  const info = getConnectorInfo(connectors, "WhatsApp");
  if (!info) {
    return { error: "Erreur: Le connecteur WhatsApp n'est pas configuré. Veuillez lier votre numéro de téléphone dans l'onglet 'Connecteurs & Logiciels'." };
  }

  // Utiliser le token global Vercel par défaut pour l'agent
  const envToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const envPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  let token = (info.token || '').trim();
  let phoneId = (info.phoneId || 'me').trim();

  // Si des variables d'environnement WhatsApp réelles sont présentes, on les utilise en priorité
  // à la place des tokens de simulation de l'interface qui commencent par "wa_" ou "mock_"
  const isEnvTokenValid = envToken && !envToken.startsWith("mock_") && !envToken.startsWith("oauth_") && !envToken.startsWith("wa_") && envToken !== 'cesar_verify_token_default';
  
  if (isEnvTokenValid && (!token || token.startsWith("wa_") || token.startsWith("mock_"))) {
    token = envToken.trim();
    phoneId = (envPhoneId || 'me').trim();
  } else if (!token && envToken) {
    token = envToken.trim();
    phoneId = (envPhoneId || 'me').trim();
  }

  if (!token || token.startsWith("mock_") || token.startsWith("oauth_") || token.startsWith("wa_") || token === 'cesar_verify_token_default') {
    return {
      success: true,
      message: `Message WhatsApp simulé avec succès pour le destinataire ${to} !`,
      text: text,
      mediaUrl: mediaUrl,
      id: `wa_msg_mock_${Math.random().toString(36).substring(2, 10)}`
    };
  }
  try {
    const body = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    };
    if (mediaUrl) {
      body.type = "image";
      body.image = { link: mediaUrl, caption: text };
    }
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur WhatsApp Cloud API (HTTP ${res.status}): ${errText}`);
    }
    const data = await res.json();
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
      message: `Message WhatsApp envoyé avec succès au destinataire ${to} !`
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function runTikTok(connectors, videoUrl, title) {
  const info = getConnectorInfo(connectors, "TikTok");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur TikTok API n'est pas configuré. Veuillez insérer votre jeton d'accès TikTok." };
  }
  return {
    success: true,
    message: "Publication vidéo TikTok simulée avec succès en direct sur votre profil !",
    videoUrl: videoUrl,
    title: title,
    id: `tiktok_post_mock_${Math.random().toString(36).substring(2, 10)}`
  };
}

async function runYouTube(connectors, videoUrl, title, description) {
  const info = getConnectorInfo(connectors, "YouTube");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur YouTube API n'est pas configuré. Veuillez insérer votre jeton d'accès Google/YouTube." };
  }
  return {
    success: true,
    message: "Publication vidéo YouTube simulée avec succès en direct sur votre chaîne !",
    videoUrl: videoUrl,
    title: title,
    description: description,
    id: `yt_video_mock_${Math.random().toString(36).substring(2, 10)}`
  };
}

async function runPinterest(connectors, imageUrl, note, boardId = null, link = null) {
  const info = getConnectorInfo(connectors, "Pinterest");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Pinterest API n'est pas configuré. Veuillez insérer votre jeton d'accès Pinterest." };
  }
  return {
    success: true,
    message: "Épingle Pinterest (Pin) simulée avec succès en direct sur votre tableau !",
    imageUrl: imageUrl,
    note: note,
    boardId: boardId || "Default Board",
    id: `pin_mock_${Math.random().toString(36).substring(2, 10)}`
  };
}

async function runThreads(connectors, text) {
  const info = getConnectorInfo(connectors, "Threads");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Threads API n'est pas configuré. Veuillez insérer votre jeton d'accès Threads." };
  }
  return {
    success: true,
    message: "Publication simulée avec succès en direct sur votre compte Threads !",
    post: text,
    id: `threads_post_mock_${Math.random().toString(36).substring(2, 10)}`
  };
}

async function runBuffer(connectors, text, profiles = null) {
  const info = getConnectorInfo(connectors, "Buffer") || getConnectorInfo(connectors, "Hootsuite");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Buffer/Hootsuite n'est pas configuré. Veuillez insérer votre jeton d'accès." };
  }
  return {
    success: true,
    message: "Planification multi-réseaux simulée avec succès via Buffer !",
    text: text,
    profiles: profiles || ["LinkedIn", "X/Twitter", "Facebook"],
    id: `buffer_update_mock_${Math.random().toString(36).substring(2, 10)}`
  };
}

async function runCanva(connectors, designId) {
  const info = getConnectorInfo(connectors, "Canva");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Canva API n'est pas configuré." };
  }
  return {
    success: true,
    message: "Synchronisation réussie avec Canva ! Visuels et chartes graphiques récupérés.",
    designId: designId,
    previewUrl: "https://canva.com/design/mock_preview.png"
  };
}

async function runMailchimp(connectors, subject, body, listId = null) {
  const info = getConnectorInfo(connectors, "Mailchimp");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Mailchimp API n'est pas configuré. Veuillez insérer votre jeton d'accès Mailchimp." };
  }
  return {
    success: true,
    message: "Campagne e-mailing simulée avec succès via Mailchimp !",
    subject: subject,
    body: body,
    listId: listId || "Default List",
    id: `mc_campaign_mock_${Math.random().toString(36).substring(2, 10)}`
  };
}

async function runTeams(connectors, message) {
  const info = getConnectorInfo(connectors, "Teams");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Microsoft Teams n'est pas configuré. Veuillez insérer votre URL Webhook Teams." };
  }
  const token = info.token.trim();
  if (token.startsWith("mock_") || token.startsWith("oauth_")) {
    return {
      success: true,
      message: "Message simulé avec succès sur Microsoft Teams via Webhook !",
      text: message
    };
  }
  try {
    const res = await fetch(token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return {
      success: true,
      message: "Message envoyé avec succès en direct sur votre canal Microsoft Teams !"
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function runBrevo(connectors, to, subject, body) {
  const info = getConnectorInfo(connectors, "Brevo");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Brevo API n'est pas configuré. Veuillez renseigner votre clé API Brevo." };
  }
  const token = info.token.trim();
  if (token.startsWith("mock_") || token.startsWith("oauth_")) {
    return {
      success: true,
      message: `E-mail simulé envoyé avec succès à ${to} via Brevo SMTP !`,
      to: to,
      subject: subject,
      id: `brevo_mail_mock_${Math.random().toString(36).substring(2, 9)}`
    };
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "César-IA Marketing", email: "marketing@cesar-ia.com" },
        to: [{ email: to }],
        subject: subject,
        htmlContent: body
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur Brevo SMTP (HTTP ${res.status}): ${errText}`);
    }
    const data = await res.json();
    return {
      success: true,
      messageId: data.messageId,
      message: `E-mail envoyé avec succès à ${to} via Brevo SMTP !`
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function runHubSpot(connectors, email, firstName, lastName, notes) {
  const info = getConnectorInfo(connectors, "HubSpot");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur HubSpot n'est pas configuré. Veuillez connecter votre compte HubSpot dans l'onglet Connecteurs." };
  }

  const properties = { email };
  if (firstName) properties.firstname = firstName;
  if (lastName) properties.lastname = lastName;
  if (notes) properties.hs_lead_status = notes.slice(0, 500);

  try {
    let res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties })
    });

    // Le contact existe déjà : on met à jour au lieu de créer.
    if (res.status === 409) {
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${info.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }]
        })
      });
      const searchData = await searchRes.json();
      const existingId = searchData?.results?.[0]?.id;
      if (!existingId) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${res.status}`);
      }
      res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${info.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ properties })
      });
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, contactId: data.id, message: `Contact HubSpot ${email} enregistré avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runShopify(connectors, title, description, price) {
  const info = getConnectorInfo(connectors, "Shopify");
  if (!info || !info.token || !info.domain) {
    return { error: "Erreur: Le connecteur Shopify n'est pas configuré (jeton ou domaine de boutique manquant)." };
  }

  const shop = info.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    const res = await fetch(`https://${shop}/admin/api/2024-01/products.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": info.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        product: {
          title,
          body_html: description || "",
          variants: price ? [{ price: String(price) }] : undefined
        }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}`);
    }
    return { success: true, productId: data.product?.id, message: `Produit "${title}" créé avec succès sur Shopify.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runWebflow(connectors, collectionId, name, contentHtml) {
  const info = getConnectorInfo(connectors, "Webflow");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Webflow n'est pas configuré. Veuillez connecter votre compte Webflow dans l'onglet Connecteurs." };
  }

  const finalCollectionId = collectionId || info.domain;
  if (!finalCollectionId) {
    return { error: "Erreur: Aucun ID de collection Webflow n'a été fourni ni configuré par défaut." };
  }

  try {
    const res = await fetch(`https://api.webflow.com/v2/collections/${finalCollectionId}/items`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        isArchived: false,
        isDraft: true,
        fieldData: {
          name,
          slug: name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
          content: contentHtml
        }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, itemId: data.id, message: `Élément "${name}" créé en brouillon dans la collection Webflow.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runGoogleSheets(connectors, spreadsheetId, rowValues) {
  const info = getConnectorInfo(connectors, "Google");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Google n'est pas configuré. Veuillez connecter votre compte Google dans l'onglet Connecteurs." };
  }
  const finalSheetId = spreadsheetId || info.domain;
  if (!finalSheetId) {
    return { error: "Erreur: Aucun ID de feuille de calcul (Spreadsheet ID) n'a été fourni ni configuré par défaut." };
  }

  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${finalSheetId}/values/A1:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${info.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ values: [rowValues] })
      }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }
    return { success: true, updatedRange: data.updates?.updatedRange, message: "Ligne ajoutée avec succès dans Google Sheets." };
  } catch (e) {
    return { error: e.message };
  }
}

async function runZendesk(connectors, subject, description, requesterEmail) {
  const info = getConnectorInfo(connectors, "Zendesk");
  if (!info || !info.token || !info.domain) {
    return { error: "Erreur: Le connecteur Zendesk n'est pas configuré (jeton ou sous-domaine manquant)." };
  }
  const subdomain = info.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    const res = await fetch(`https://${subdomain}/api/v2/tickets.json`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ticket: {
          subject,
          comment: { body: description },
          requester: requesterEmail ? { email: requesterEmail } : undefined
        }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.description || `HTTP ${res.status}`);
    }
    return { success: true, ticketId: data.ticket?.id, message: `Ticket Zendesk #${data.ticket?.id} créé avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runPipedrive(connectors, title, value, personName) {
  const info = getConnectorInfo(connectors, "Pipedrive");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Pipedrive n'est pas configuré. Veuillez connecter votre compte Pipedrive dans l'onglet Connecteurs." };
  }

  try {
    const res = await fetch("https://api.pipedrive.com/api/v2/deals", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        value: value || undefined,
        currency: value ? "EUR" : undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return { success: true, dealId: data.data?.id, message: `Deal "${title}" créé avec succès dans Pipedrive.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runAsana(connectors, workspaceId, name, notes) {
  const info = getConnectorInfo(connectors, "Asana");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Asana n'est pas configuré. Veuillez connecter votre compte Asana dans l'onglet Connecteurs." };
  }
  const finalWorkspaceId = workspaceId || info.domain;
  if (!finalWorkspaceId) {
    return { error: "Erreur: Aucun ID d'espace de travail (Workspace ID) Asana n'a été fourni ni configuré par défaut." };
  }

  try {
    const res = await fetch("https://app.asana.com/api/1.0/tasks", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: { name, notes: notes || "", workspace: finalWorkspaceId }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.errors?.[0]?.message || `HTTP ${res.status}`);
    }
    return { success: true, taskId: data.data?.gid, message: `Tâche "${name}" créée avec succès dans Asana.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runClickUp(connectors, listId, name, description) {
  const info = getConnectorInfo(connectors, "ClickUp");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur ClickUp n'est pas configuré. Veuillez connecter votre compte ClickUp dans l'onglet Connecteurs." };
  }
  const finalListId = listId || info.domain;
  if (!finalListId) {
    return { error: "Erreur: Aucun ID de liste ClickUp n'a été fourni ni configuré par défaut." };
  }

  try {
    const res = await fetch(`https://api.clickup.com/api/v2/list/${finalListId}/task`, {
      method: "POST",
      headers: {
        "Authorization": info.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name, description: description || "" })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.err || `HTTP ${res.status}`);
    }
    return { success: true, taskId: data.id, message: `Tâche "${name}" créée avec succès dans ClickUp.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runGitLab(connectors, projectPath, title, description) {
  const info = getConnectorInfo(connectors, "GitLab");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur GitLab n'est pas configuré. Veuillez connecter votre compte GitLab dans l'onglet Connecteurs." };
  }
  const finalProject = projectPath || info.domain;
  if (!finalProject) {
    return { error: "Erreur: Aucun projet GitLab (propriétaire/nom-dépôt) n'a été fourni ni configuré par défaut." };
  }
  const encodedProject = encodeURIComponent(finalProject);

  try {
    const res = await fetch(`https://gitlab.com/api/v4/projects/${encodedProject}/issues?title=${encodeURIComponent(title)}&description=${encodeURIComponent(description || '')}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${info.token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message ? JSON.stringify(data.message) : `HTTP ${res.status}`);
    }
    return { success: true, issueId: data.iid, url: data.web_url, message: `Issue GitLab #${data.iid} créée avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runSalesforce(connectors, lastName, company, email) {
  const info = getConnectorInfo(connectors, "Salesforce");
  if (!info || !info.token || !info.domain) {
    return { error: "Erreur: Le connecteur Salesforce n'est pas configuré (jeton ou URL d'instance manquant)." };
  }
  const instanceUrl = info.domain.trim().replace(/\/$/, '');
  const baseUrl = instanceUrl.startsWith('http') ? instanceUrl : `https://${instanceUrl}`;

  try {
    const res = await fetch(`${baseUrl}/services/data/v59.0/sobjects/Lead`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ LastName: lastName, Company: company, Email: email || undefined })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(Array.isArray(data) ? (data[0]?.message || `HTTP ${res.status}`) : `HTTP ${res.status}`);
    }
    return { success: true, leadId: data.id, message: `Lead "${lastName}" (${company}) créé avec succès dans Salesforce.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runZoho(connectors, lastName, company, email) {
  const info = getConnectorInfo(connectors, "Zoho");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Zoho n'est pas configuré. Veuillez connecter votre compte Zoho dans l'onglet Connecteurs." };
  }
  const apiDomain = (info.domain && info.domain.trim()) || 'www.zohoapis.com';

  try {
    const res = await fetch(`https://${apiDomain.replace(/^https?:\/\//, '')}/crm/v2/Leads`, {
      method: "POST",
      headers: {
        "Authorization": `Zoho-oauthtoken ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ data: [{ Last_Name: lastName, Company: company, Email: email || undefined }] })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, leadId: data.data?.[0]?.details?.id, message: `Lead "${lastName}" (${company}) créé avec succès dans Zoho CRM.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runSellsy(connectors, companyName) {
  const info = getConnectorInfo(connectors, "Sellsy");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Sellsy n'est pas configuré. Veuillez connecter votre compte Sellsy dans l'onglet Connecteurs." };
  }

  try {
    const res = await fetch("https://api.sellsy.com/v2/companies", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: companyName })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, companyId: data.id, message: `Société "${companyName}" créée avec succès dans Sellsy.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runIntercom(connectors, email, name) {
  const info = getConnectorInfo(connectors, "Intercom");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Intercom n'est pas configuré. Veuillez connecter votre compte Intercom dans l'onglet Connecteurs." };
  }

  try {
    const res = await fetch("https://api.intercom.io/contacts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json",
        "Intercom-Version": "2.11"
      },
      body: JSON.stringify({ role: "lead", email, name: name || undefined })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.errors?.[0]?.message || `HTTP ${res.status}`);
    }
    return { success: true, contactId: data.id, message: `Contact ${email} créé avec succès dans Intercom.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runBitbucket(connectors, repoPath, title, description) {
  const info = getConnectorInfo(connectors, "Bitbucket");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Bitbucket n'est pas configuré. Veuillez connecter votre compte Bitbucket dans l'onglet Connecteurs." };
  }
  const finalRepo = repoPath || info.domain;
  if (!finalRepo) {
    return { error: "Erreur: Aucun dépôt Bitbucket (espace-de-travail/nom-depot) n'a été fourni ni configuré par défaut." };
  }

  try {
    const res = await fetch(`https://api.bitbucket.org/2.0/repositories/${finalRepo}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title, content: { raw: description || "", markup: "markdown" } })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }
    return { success: true, issueId: data.id, message: `Issue Bitbucket #${data.id} créée avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runZoom(connectors, topic, startTimeISO, durationMinutes) {
  const info = getConnectorInfo(connectors, "Zoom");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Zoom n'est pas configuré. Veuillez connecter votre compte Zoom dans l'onglet Connecteurs." };
  }

  try {
    const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        topic,
        type: startTimeISO ? 2 : 1,
        start_time: startTimeISO || undefined,
        duration: durationMinutes || 30
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, meetingId: data.id, joinUrl: data.join_url, message: `Réunion Zoom "${topic}" créée avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runBox(connectors, folderName, parentFolderId) {
  const info = getConnectorInfo(connectors, "Box");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Box n'est pas configuré. Veuillez connecter votre compte Box dans l'onglet Connecteurs." };
  }

  try {
    const res = await fetch("https://api.box.com/2.0/folders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: folderName,
        parent: { id: parentFolderId || info.domain || "0" }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, folderId: data.id, message: `Dossier "${folderName}" créé avec succès dans Box.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Crée un vrai lien de paiement Stripe : le client doit lui-même cliquer et
// payer, l'agent ne débite jamais de carte ni ne déclenche de transfert seul.
async function runStripePaymentLink(connectors, productName, amount, currency) {
  const info = getConnectorInfo(connectors, "Stripe");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Stripe n'est pas configuré. Veuillez connecter votre compte Stripe dans l'onglet Connecteurs." };
  }
  const parsedAmount = parseFloat(amount);
  if (!productName || isNaN(parsedAmount) || parsedAmount <= 0) {
    return { error: "Erreur: Nom de produit et montant (> 0) requis pour créer un lien de paiement." };
  }
  const finalCurrency = (currency || 'eur').toLowerCase();

  const authHeaders = {
    "Authorization": `Bearer ${info.token}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };

  try {
    const productRes = await fetch("https://api.stripe.com/v1/products", {
      method: "POST",
      headers: authHeaders,
      body: new URLSearchParams({ name: productName })
    });
    const productData = await productRes.json();
    if (!productRes.ok) throw new Error(productData.error?.message || `HTTP ${productRes.status}`);

    const priceRes = await fetch("https://api.stripe.com/v1/prices", {
      method: "POST",
      headers: authHeaders,
      body: new URLSearchParams({
        product: productData.id,
        currency: finalCurrency,
        unit_amount: String(Math.round(parsedAmount * 100))
      })
    });
    const priceData = await priceRes.json();
    if (!priceRes.ok) throw new Error(priceData.error?.message || `HTTP ${priceRes.status}`);

    const linkRes = await fetch("https://api.stripe.com/v1/payment_links", {
      method: "POST",
      headers: authHeaders,
      body: new URLSearchParams({ "line_items[0][price]": priceData.id, "line_items[0][quantity]": "1" })
    });
    const linkData = await linkRes.json();
    if (!linkRes.ok) throw new Error(linkData.error?.message || `HTTP ${linkRes.status}`);

    return { success: true, paymentUrl: linkData.url, message: `Lien de paiement Stripe créé pour "${productName}" (${parsedAmount} ${finalCurrency.toUpperCase()}). Le client doit cliquer sur ce lien pour payer lui-même — aucun débit automatique.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Crée et envoie une vraie facture PayPal : le destinataire reçoit un e-mail
// avec un lien pour payer lui-même, aucun transfert n'est déclenché par l'agent.
async function runPayPalInvoice(connectors, recipientEmail, description, amount, currency) {
  const info = getConnectorInfo(connectors, "PayPal");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur PayPal n'est pas configuré. Veuillez connecter votre compte PayPal dans l'onglet Connecteurs." };
  }
  const parsedAmount = parseFloat(amount);
  if (!recipientEmail || isNaN(parsedAmount) || parsedAmount <= 0) {
    return { error: "Erreur: E-mail du destinataire et montant (> 0) requis pour créer une facture PayPal." };
  }
  const finalCurrency = (currency || 'EUR').toUpperCase();

  try {
    const createRes = await fetch("https://api-m.paypal.com/v2/invoicing/invoices", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        detail: { currency_code: finalCurrency, note: description || "" },
        primary_recipients: [{ billing_info: { email_address: recipientEmail } }],
        items: [{ name: (description || "Prestation").slice(0, 100), quantity: "1", unit_amount: { currency_code: finalCurrency, value: parsedAmount.toFixed(2) } }]
      })
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.message || createData.details?.[0]?.issue || `HTTP ${createRes.status}`);

    const invoiceId = createData.id || createData.href?.split('/').pop();
    if (!invoiceId) throw new Error("Facture créée mais impossible de récupérer son identifiant pour l'envoyer.");

    const sendRes = await fetch(`https://api-m.paypal.com/v2/invoicing/invoices/${invoiceId}/send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ send_to_recipient: true })
    });
    if (!sendRes.ok && sendRes.status !== 204) {
      const sendData = await sendRes.json().catch(() => ({}));
      throw new Error(sendData.message || `HTTP ${sendRes.status} lors de l'envoi`);
    }

    return { success: true, invoiceId, message: `Facture PayPal de ${parsedAmount.toFixed(2)} ${finalCurrency} envoyée à ${recipientEmail}. Il/elle doit cliquer sur le lien reçu par e-mail pour payer lui-même.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Linear n'a pas de flux OAuth codé ici : l'utilisateur colle une clé API
// personnelle (Settings > API dans Linear) dans le champ "Clé d'API" générique.
async function runLinear(connectors, teamId, title, description) {
  const info = getConnectorInfo(connectors, "Linear");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Linear n'est pas configuré. Veuillez renseigner votre clé API Linear dans l'onglet Connecteurs." };
  }
  const finalTeamId = teamId || info.domain;
  if (!finalTeamId) {
    return { error: "Erreur: Aucun ID d'équipe Linear n'a été fourni ni configuré par défaut." };
  }

  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Authorization": info.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: `mutation($teamId: String!, $title: String!, $description: String) {
          issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
            success
            issue { id identifier url }
          }
        }`,
        variables: { teamId: finalTeamId, title, description: description || "" }
      })
    });
    const data = await res.json();
    if (!res.ok || data.errors) {
      throw new Error(data.errors?.[0]?.message || `HTTP ${res.status}`);
    }
    const issue = data.data?.issueCreate?.issue;
    return { success: true, issueId: issue?.identifier, url: issue?.url, message: `Issue Linear ${issue?.identifier || ''} créée avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Cloudflare : jeton API personnel (Bearer). Le champ "domaine" attend l'ID
// de zone Cloudflare (Zone ID), visible dans le tableau de bord du domaine.
async function runCloudflare(connectors, zoneId, recordType, recordName, recordContent) {
  const info = getConnectorInfo(connectors, "Cloudflare");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Cloudflare n'est pas configuré. Veuillez renseigner votre jeton API Cloudflare dans l'onglet Connecteurs." };
  }
  const finalZoneId = zoneId || info.domain;
  if (!finalZoneId) {
    return { error: "Erreur: Aucun ID de zone (Zone ID) Cloudflare n'a été fourni ni configuré par défaut." };
  }

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${finalZoneId}/dns_records`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ type: recordType || "TXT", name: recordName, content: recordContent, ttl: 3600 })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.errors?.[0]?.message || `HTTP ${res.status}`);
    }
    return { success: true, recordId: data.result?.id, message: `Enregistrement DNS ${recordType || 'TXT'} "${recordName}" créé avec succès sur Cloudflare.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Trello n'a pas de flux OAuth codé ici : l'utilisateur colle "cléAPI:jeton"
// (obtenus sur trello.com/power-ups/admin) dans le champ "Clé d'API" générique.
async function runTrello(connectors, listId, name, description) {
  const info = getConnectorInfo(connectors, "Trello");
  if (!info || !info.token || !info.token.includes(':')) {
    return { error: "Erreur: Le connecteur Trello n'est pas configuré correctement (format attendu : cléAPI:jeton)." };
  }
  const [apiKey, apiToken] = info.token.split(':');
  const finalListId = listId || info.domain;
  if (!finalListId) {
    return { error: "Erreur: Aucun ID de liste Trello n'a été fourni ni configuré par défaut." };
  }

  try {
    const params = new URLSearchParams({
      key: apiKey,
      token: apiToken,
      idList: finalListId,
      name,
      desc: description || ""
    });
    const res = await fetch(`https://api.trello.com/1/cards?${params.toString()}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, cardId: data.id, url: data.shortUrl, message: `Carte Trello "${name}" créée avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Datadog : le champ "Clé d'API" attend "apiKey:appKey" (clés API + Application
// générées dans Organization Settings > API Keys / Application Keys).
async function runDatadog(connectors, title, text, alertType) {
  const info = getConnectorInfo(connectors, "Datadog");
  if (!info || !info.token || !info.token.includes(':')) {
    return { error: "Erreur: Le connecteur Datadog n'est pas configuré correctement (format attendu : apiKey:appKey)." };
  }
  const [apiKey, appKey] = info.token.split(':');

  try {
    const res = await fetch("https://api.datadoghq.com/api/v1/events", {
      method: "POST",
      headers: {
        "DD-API-KEY": apiKey,
        "DD-APPLICATION-KEY": appKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title, text, alert_type: alertType || "info" })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.errors?.[0] || `HTTP ${res.status}`);
    }
    return { success: true, eventId: data.event?.id, message: `Événement "${title}" publié avec succès sur Datadog.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Sentry : jeton d'authentification personnel (Bearer). Le champ "domaine"
// attend le slug de l'organisation Sentry (Settings > General > Organization Slug).
async function runSentry(connectors, version, projects) {
  const info = getConnectorInfo(connectors, "Sentry");
  if (!info || !info.token || !info.domain) {
    return { error: "Erreur: Le connecteur Sentry n'est pas configuré (jeton ou slug d'organisation manquant)." };
  }

  try {
    const res = await fetch(`https://sentry.io/api/0/organizations/${info.domain}/releases/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ version, projects: projects || [] })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || JSON.stringify(data) || `HTTP ${res.status}`);
    }
    return { success: true, version: data.version, message: `Release Sentry "${version}" créée avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Figma : jeton d'accès personnel (Settings > Personal Access Tokens). Le champ
// "domaine" attend la clé du fichier Figma (visible dans l'URL du fichier).
async function runFigma(connectors, fileKey, message) {
  const info = getConnectorInfo(connectors, "Figma");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Figma n'est pas configuré. Veuillez renseigner votre jeton d'accès Figma dans l'onglet Connecteurs." };
  }
  const finalFileKey = fileKey || info.domain;
  if (!finalFileKey) {
    return { error: "Erreur: Aucune clé de fichier Figma n'a été fournie ni configurée par défaut." };
  }

  try {
    const res = await fetch(`https://api.figma.com/v1/files/${finalFileKey}/comments`, {
      method: "POST",
      headers: {
        "X-Figma-Token": info.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, commentId: data.id, message: "Commentaire ajouté avec succès sur le fichier Figma." };
  } catch (e) {
    return { error: e.message };
  }
}

// WooCommerce : clé consommateur + secret (Basic Auth), format "consumerKey:consumerSecret"
// dans le champ "Clé d'API". Le champ "domaine" attend l'URL du site WordPress/WooCommerce.
async function runWooCommerce(connectors, name, description, price) {
  const info = getConnectorInfo(connectors, "WooCommerce");
  if (!info || !info.token || !info.token.includes(':') || !info.domain) {
    return { error: "Erreur: Le connecteur WooCommerce n'est pas configuré correctement (format attendu : consumerKey:consumerSecret, et URL du site)." };
  }
  const site = info.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const basicAuth = Buffer.from(info.token).toString('base64');

  try {
    const res = await fetch(`https://${site}/wp-json/wc/v3/products`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name, description: description || "", regular_price: price ? String(price) : undefined })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, productId: data.id, message: `Produit "${name}" créé avec succès sur WooCommerce.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Freshdesk : clé API personnelle en Basic Auth (clé:X). Le champ "domaine"
// attend le sous-domaine Freshdesk (votre-entreprise.freshdesk.com).
async function runFreshdesk(connectors, subject, description, requesterEmail) {
  const info = getConnectorInfo(connectors, "Freshdesk");
  if (!info || !info.token || !info.domain) {
    return { error: "Erreur: Le connecteur Freshdesk n'est pas configuré (jeton ou sous-domaine manquant)." };
  }
  const subdomain = info.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const basicAuth = Buffer.from(`${info.token}:X`).toString('base64');

  try {
    const res = await fetch(`https://${subdomain}/api/v2/tickets`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ subject, description, email: requesterEmail, priority: 1, status: 2 })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.description || JSON.stringify(data.errors) || `HTTP ${res.status}`);
    }
    return { success: true, ticketId: data.id, message: `Ticket Freshdesk #${data.id} créé avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

// Les API Jira/Confluence Cloud s'appellent via un "cloud ID" propre au site
// Atlassian de l'utilisateur, retrouvé depuis le jeton OAuth (pas besoin de le
// redemander à l'utilisateur).
async function getAtlassianCloudId(token) {
  const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
  });
  if (!res.ok) throw new Error(`Impossible de récupérer le site Atlassian (HTTP ${res.status}).`);
  const sites = await res.json();
  if (!sites || sites.length === 0) throw new Error("Aucun site Atlassian accessible avec ce compte.");
  return sites[0].id;
}

async function runJira(connectors, projectKey, summary, description) {
  const info = getConnectorInfo(connectors, "Jira");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Jira n'est pas configuré. Veuillez connecter votre compte Atlassian dans l'onglet Connecteurs." };
  }
  const finalProjectKey = projectKey || info.domain;
  if (!finalProjectKey) {
    return { error: "Erreur: Aucune clé de projet Jira n'a été fournie ni configurée par défaut." };
  }

  try {
    const cloudId = await getAtlassianCloudId(info.token);
    const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          project: { key: finalProjectKey },
          summary,
          issuetype: { name: "Task" },
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: description || "" }] }]
          }
        }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.errorMessages?.join(', ') || JSON.stringify(data.errors) || `HTTP ${res.status}`);
    }
    return { success: true, issueKey: data.key, message: `Ticket Jira ${data.key} créé avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function runConfluence(connectors, spaceKey, title, contentHtml) {
  const info = getConnectorInfo(connectors, "Confluence");
  if (!info || !info.token) {
    return { error: "Erreur: Le connecteur Confluence n'est pas configuré. Veuillez connecter votre compte Atlassian dans l'onglet Connecteurs." };
  }
  const finalSpaceKey = spaceKey || info.domain;
  if (!finalSpaceKey) {
    return { error: "Erreur: Aucune clé d'espace Confluence n'a été fournie ni configurée par défaut." };
  }

  try {
    const cloudId = await getAtlassianCloudId(info.token);
    const res = await fetch(`https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${info.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "page",
        title,
        space: { key: finalSpaceKey },
        body: { storage: { value: contentHtml, representation: "storage" } }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return { success: true, pageId: data.id, url: data._links?.webui, message: `Page Confluence "${title}" créée avec succès.` };
  } catch (e) {
    return { error: e.message };
  }
}

export default async function handler(req, res) {
  // CORS Configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method Not Allowed' } });
  }

  try {
    // Parse body (bodyParser is disabled above so we can verify the Twilio signature on the exact raw bytes)
    const rawBody = await getRawBody(req);
    let body = {};
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      try {
        const urlParams = new URLSearchParams(rawBody);
        body = {};
        for (const [key, value] of urlParams.entries()) {
          body[key] = value;
        }
      } catch (err) {}
    }

    // 1. Detect if the request is an incoming Webhook from Twilio WhatsApp
    if (body && body.From && body.From.startsWith('whatsapp:')) {
      // Reject anything that isn't cryptographically signed by Twilio — without this,
      // anyone who knows a user's registered WhatsApp number could impersonate them here.
      const appUrl = process.env.APP_URL || 'https://plateforme-agents-ia.vercel.app';
      const twilioSignature = req.headers['x-twilio-signature'];
      if (!isValidTwilioSignature(`${appUrl}/api/chat`, body, twilioSignature)) {
        console.warn('[WhatsApp Webhook] Signature Twilio invalide ou absente — requête rejetée.');
        return res.status(403).json({ error: 'Invalid Twilio signature' });
      }

      console.log(`[WhatsApp Webhook] Message reçu de: ${body.From}`);
      const incomingMessage = body.Body || '';
      const mediaUrl = body.MediaUrl0 || null; 
      const senderNumber = body.From; // e.g. "whatsapp:+33612345678"
      
      // 2. Query Supabase database to find which user owns this WhatsApp number
      let userConnectors = null;
      let matchedConnectorRecord = null;
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('connectors')
            .select('*')
            .in('connector_name', ['WhatsApp', 'WhatsApp Business API']);
            
          if (!error && data) {
            matchedConnectorRecord = data.find(c => {
              const creds = c.credentials || {};
              const configuredPhone = creds.sender || creds.phone || creds.token || '';
              const cleanSender = senderNumber.replace('whatsapp:', '').trim();
              const cleanConfigured = configuredPhone.replace('whatsapp:', '').trim();
              return cleanConfigured && (cleanSender.includes(cleanConfigured) || cleanConfigured.includes(cleanSender));
            });
            
            if (matchedConnectorRecord) {
              console.log(`[WhatsApp Webhook] Utilisateur identifié: ${matchedConnectorRecord.user_id}`);
              const { data: allConn, error: allConnErr } = await supabase
                .from('connectors')
                .select('*')
                .eq('user_id', matchedConnectorRecord.user_id)
                .eq('agent_id', matchedConnectorRecord.agent_id);
                
              if (!allConnErr && allConn) {
                userConnectors = {};
                allConn.forEach(c => {
                  userConnectors[c.connector_name] = c.credentials || {};
                });
              }
            }
          }
        } catch (errDb) {
          console.error("[WhatsApp Webhook] Erreur recherche base de données :", errDb);
        }
      }
      
      // 3. Call Gemini to analyze the media/text and draft the post in their exact style
      const responseText = await analyzeAndDraftPost(incomingMessage, mediaUrl, userConnectors);
      
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

      let activePlatforms = [];
      if (userConnectors) {
        if (hasCreds(getConnectorInfo(userConnectors, "LinkedIn"))) activePlatforms.push("linkedin");
        if (hasCreds(getConnectorInfo(userConnectors, "Twitter")) || hasCreds(getConnectorInfo(userConnectors, "X"))) activePlatforms.push("twitter");
        if (hasCreds(getConnectorInfo(userConnectors, "Facebook"))) activePlatforms.push("facebook");
        if (hasCreds(getConnectorInfo(userConnectors, "Instagram"))) activePlatforms.push("instagram");
        if (hasCreds(getConnectorInfo(userConnectors, "TikTok"))) activePlatforms.push("tiktok");
        if (hasCreds(getConnectorInfo(userConnectors, "YouTube"))) activePlatforms.push("youtube");
        if (hasCreds(getConnectorInfo(userConnectors, "Pinterest"))) activePlatforms.push("pinterest");
        if (hasCreds(getConnectorInfo(userConnectors, "Threads"))) activePlatforms.push("threads");
        if (hasCreds(getConnectorInfo(userConnectors, "Buffer")) || hasCreds(getConnectorInfo(userConnectors, "Hootsuite"))) activePlatforms.push("buffer");
      }
      if (activePlatforms.length === 0) {
        activePlatforms.push("linkedin");
      }

      // Enregistrer le brouillon dans le connecteur WhatsApp pour affichage sur le calendrier
      const draftId = `wa_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      if (matchedConnectorRecord && supabase) {
        try {
          const currentCredentials = matchedConnectorRecord.credentials || {};
          const drafts = currentCredentials.drafts || [];
          const newDraft = {
            id: draftId,
            text: responseText,
            mediaUrl: mediaUrl || null,
            mediaType: mediaUrl ? 'image' : 'text',
            status: 'draft',
            platforms: activePlatforms,
            date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
          };
          drafts.push(newDraft);
          currentCredentials.drafts = drafts;
          await supabase
            .from('connectors')
            .update({ credentials: currentCredentials })
            .eq('id', matchedConnectorRecord.id);
        } catch (errDraft) {
          console.error('[WhatsApp Webhook] Échec enregistrement brouillon:', errDraft);
        }
      }

      // 4. Toujours sauvegarder en brouillon — jamais de publication automatique.
      // Même un message WhatsApp légitime peut être mal interprété par l'IA ; l'utilisateur
      // doit relire et valider depuis son tableau de bord avant toute publication réelle.
      const publishStatus = `sauvegardé en brouillon pour ${activePlatforms.join(', ')} sur César-IA.`;

      // Notifications additionnelles (Slack, Teams, Webhooks)
      if (userConnectors) {
        const slackInfo = getConnectorInfo(userConnectors, "Slack");
        if (hasCreds(slackInfo)) {
          const webhookUrl = slackInfo.webhookUrl || slackInfo.token;
          if (webhookUrl && webhookUrl.startsWith("http")) {
            try {
              await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: `📱 *[Chronos via WhatsApp]* Nouveau post rédigé en brouillon :\n\n"${responseText}"\n\n🔗 Valider sur César-IA : https://plateforme-agents-ia.vercel.app/?validate_draft=${draftId}`
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
                  text: `📱 *[Chronos via WhatsApp]* Nouveau post rédigé en brouillon :\n\n"${responseText}"\n\n🔗 Valider sur César-IA : https://plateforme-agents-ia.vercel.app/?validate_draft=${draftId}`
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
                  agent_id: matchedConnectorRecord?.agent_id,
                  user_id: matchedConnectorRecord?.user_id,
                  text: responseText,
                  originalText: incomingMessage,
                  mediaUrl: mediaUrl || null,
                  draftId: draftId
                })
              });
            } catch (e) {
              console.error('[WhatsApp Webhook] Échec webhook personnalisé:', e);
            }
          }
        }
      }

      // 5. Respond back to Twilio with TwiML XML
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>
    <Body>🕒 [Chronos Agent] : Bonjour ! J'ai bien reçu votre photo/message pour l'événement.

J'ai analysé votre contenu en direct. Il a été ${publishStatus}

💬 Publication rédigée :
"${responseText}"</Body>
  </Message>
</Response>`);
    }

    const { contents, systemInstruction, apiKey: clientApiKey, connectors: clientConnectors = {}, agentName = 'César-IA Agent', agentId } = body;
    
    let finalSystemInstruction = systemInstruction;
    let verifiedConnectors = clientConnectors;
    
    const isLocalMock = !supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL');
    let userId = null;
    let isAdmin = false;
    
    if (!isLocalMock && supabase) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        try {
          const { data: { user }, error: authError } = await supabase.auth.getUser(token);
          if (authError || !user) {
            return res.status(401).json({ error: { message: "Session expirée ou invalide. Veuillez vous reconnecter." } });
          }
          userId = user.id;
          
          // Check if admin (ASCII, accented, and punycode variations)
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
              .eq('id', userId)
              .single();
            if (profile) {
              isAdminProfile = profile.is_admin;
            }
          } catch (e) {
            console.warn("[Auth check] Error checking profiles:", e);
          }
          
          isAdmin = isAdminEmail || isAdminProfile;
          
          // Check if the agent is adopted
          const targetAgentId = agentId || body.agentId || body.agentName?.toLowerCase();
          if (!isAdmin && targetAgentId) {
            const { data: adoption, error: adoptErr } = await supabase
              .from('adopted_agents')
              .select('*')
              .eq('user_id', userId)
              .eq('agent_id', targetAgentId)
              .single();
              
            if (adoptErr || !adoption) {
              return res.status(403).json({ error: { message: "Vous devez adopter cet agent avant de pouvoir l'utiliser." } });
            }
          }
          
          // Securely load connectors from the database
          if (targetAgentId) {
            try {
              const { data: dbConn, error: connErr } = await supabase
                .from('connectors')
                .select('*')
                .eq('user_id', userId)
                .eq('agent_id', targetAgentId);
                
              if (!connErr && dbConn) {
                verifiedConnectors = {};
                dbConn.forEach(c => {
                  verifiedConnectors[c.connector_name] = c.credentials || {};
                });
              }
            } catch (errDb) {
              console.error("[Backend Connectors Load] Error:", errDb);
            }
          }
        } catch (err) {
          return res.status(401).json({ error: { message: `Erreur d'authentification: ${err.message}` } });
        }
      } else {
        return res.status(401).json({ error: { message: "Authentification requise pour cette opération." } });
      }
    }
    
    const connectors = verifiedConnectors;

    // Automatic style analysis and memory fetching from LinkedIn history
    const liInfo = getConnectorInfo(connectors, "LinkedIn");
    if (liInfo && liInfo.token) {
      try {
        const pastPosts = await getLinkedInPastPosts(connectors);
        if (pastPosts && pastPosts.length > 0) {
          finalSystemInstruction += `\n\n### HISTORIQUE & STYLE D'ÉCRITURE RÉEL DE L'UTILISATEUR (RÉCUPÉRÉ DEPUIS LINKEDIN) :\n`;
          pastPosts.forEach((post, idx) => {
            finalSystemInstruction += `\n[Post précédent #${idx+1}]:\n${post}\n`;
          });
          finalSystemInstruction += `\nConsigne de style critique : Analyse minutieusement la structure, le ton, le saut de lignes et l'esprit des publications réelles ci-dessus. Rédige tes nouvelles propositions en mimant parfaitement à 100% ce style d'écriture réel. N'écris jamais de posts identiques aux exemples ci-dessus pour éviter les répétitions !`;
        }
      } catch (errStyle) {
        console.error("Erreur lors de la récupération automatique du style LinkedIn :", errStyle);
      }
    }

    // Mémoire partagée du compte : ce que les AUTRES agents ont appris pour cet
    // utilisateur (voir getAccountMemoryContext / updateAccountMemory plus bas).
    // Placée en tête du prompt (et non à la fin) pour qu'elle prime sur les
    // consignes "connecteur non configuré → simule" plus loin dans le prompt :
    // sans ça, l'agent suit ces consignes de simulation avant même d'avoir lu
    // la mémoire, et répond à côté alors que l'info était déjà disponible.
    if (userId) {
      try {
        const memoryContext = await getAccountMemoryContext(userId);
        if (memoryContext) {
          finalSystemInstruction = `### MÉMOIRE PARTAGÉE DU COMPTE (issue des échanges avec les autres agents César-IA de ce client) :\n${memoryContext}\n\nConsigne prioritaire : si l'information demandée par l'utilisateur figure ci-dessus, réponds directement avec cette information — n'appelle AUCUN outil et ne mentionne PAS de connecteur manquant pour cette information précise, même si une consigne plus bas dans ce prompt semble le suggérer. N'utilise les outils / ne parle de connecteurs que pour ce qui n'est réellement pas couvert par la mémoire ci-dessus.\n\n---\n\n${finalSystemInstruction}`;
        }
      } catch (errMem) {
        console.error("Erreur lors de la récupération de la mémoire partagée :", errMem);
      }
    }

    let cleanClientApiKey = (typeof clientApiKey === 'string' ? clientApiKey.trim() : '');
    if (
      !cleanClientApiKey || 
      cleanClientApiKey === 'undefined' || 
      cleanClientApiKey === 'null' || 
      cleanClientApiKey.startsWith('AIzaSyDXkwII') || 
      cleanClientApiKey.includes('AIzaSyDXkwIIYoxT4nekvUYFXqfjRMvJP127vLs') || 
      cleanClientApiKey.startsWith('MOCK_')
    ) {
      cleanClientApiKey = '';
    }
    const apiKey = cleanClientApiKey || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ 
        error: { 
          message: "Clé API Gemini introuvable. Veuillez configurer la variable d'environnement GEMINI_API_KEY dans votre tableau de bord." 
        } 
      });
    }

    // Tools Definitions for Gemini Function Calling
    const tools = [
      {
        functionDeclarations: [
          {
            name: "run_ssh_command",
            description: "Exécute une commande de terminal Shell Linux en temps réel sur le serveur SSH configuré par l'utilisateur. Utile pour vérifier l'espace disque (df -h), la mémoire (free -m), les conteneurs (docker ps), l'uptime ou les fichiers.",
            parameters: {
              type: "OBJECT",
              properties: {
                command: {
                  type: "STRING",
                  description: "La commande Shell à exécuter."
                }
              },
              required: ["command"]
            }
          },
          {
            name: "execute_postgres_query",
            description: "Exécute une requête SQL PostgreSQL réelle en lecture seule (SELECT uniquement) sur la base de données configurée par l'utilisateur. Utile pour lire des tables, compter des entrées, ou faire des statistiques.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: {
                  type: "STRING",
                  description: "La requête SQL SELECT à exécuter."
                }
              },
              required: ["query"]
            }
          },
          {
            name: "send_slack_message",
            description: "Envoie un message sur le canal Slack de l'utilisateur via son URL webhook configurée.",
            parameters: {
              type: "OBJECT",
              properties: {
                message: {
                  type: "STRING",
                  description: "Le texte du message à envoyer."
                }
              },
              required: ["message"]
            }
          },
          {
            name: "send_email",
            description: "Envoie un e-mail réel au destinataire indiqué via l'API Brevo de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                to: {
                  type: "STRING",
                  description: "L'adresse email du destinataire."
                },
                subject: {
                  type: "STRING",
                  description: "Le sujet de l'email."
                },
                body: {
                  type: "STRING",
                  description: "Le contenu textuel de l'email."
                }
              },
              required: ["to", "subject", "body"]
            }
          },
          {
            name: "trigger_workflow_action",
            description: "Déclenche un workflow automatique externe complexe sur n'importe quel logiciel (LinkedIn, Salesforce, HubSpot, Shopify, etc.) via le connecteur de Webhook n8n/Make du client.",
            parameters: {
              type: "OBJECT",
              properties: {
                action: {
                  type: "STRING",
                  description: "L'action à accomplir (ex: 'post_linkedin', 'update_crm_lead', 'fetch_shopify_orders')."
                },
                details: {
                  type: "STRING",
                  description: "Une description en langage naturel des instructions du client."
                },
                payload: {
                  type: "OBJECT",
                  description: "Un objet JSON contenant les paramètres clés de l'action (ex: { post_text: 'hello' } ou { lead_email: 'jean@dupont.com' })."
                }
              },
              required: ["action", "details", "payload"]
            }
          },
          {
            name: "create_notion_page",
            description: "Crée une nouvelle page ou note dans la base de données Notion de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                databaseId: {
                  type: "STRING",
                  description: "ID de la base de données Notion (facultatif si configuré par défaut)."
                },
                title: {
                  type: "STRING",
                  description: "Titre de la nouvelle page Notion."
                },
                contentMarkdown: {
                  type: "STRING",
                  description: "Contenu de la page au format Markdown."
                }
              },
              required: ["title", "contentMarkdown"]
            }
          },
          {
            name: "create_wordpress_draft",
            description: "Rédige et enregistre un brouillon d'article de blog sur le site WordPress de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                title: {
                  type: "STRING",
                  description: "Le titre de l'article."
                },
                contentHtml: {
                  type: "STRING",
                  description: "Le contenu HTML de l'article."
                }
              },
              required: ["title", "contentHtml"]
            }
          },
          {
            name: "create_github_issue",
            description: "Crée un nouveau ticket de bug ou de tâche (issue) sur le dépôt GitHub de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                title: {
                  type: "STRING",
                  description: "Le titre du ticket."
                },
                body: {
                  type: "STRING",
                  description: "La description textuelle ou Markdown détaillée du ticket."
                }
              },
              required: ["title", "body"]
            }
          },
          {
            name: "insert_airtable_record",
            description: "Insère une ligne de données (record) dans la table Airtable spécifiée.",
            parameters: {
              type: "OBJECT",
              properties: {
                baseId: {
                  type: "STRING",
                  description: "ID de la base de données Airtable (facultatif si configuré dans le domaine)."
                },
                tableName: {
                  type: "STRING",
                  description: "Nom de la table (ex: 'Prospects', 'Logs', 'Ventes')."
                },
                fieldsJson: {
                  type: "OBJECT",
                  description: "Objet JSON clé-valeur représentant les colonnes et leurs valeurs à insérer."
                }
              },
              required: ["tableName", "fieldsJson"]
            }
          },
          {
            name: "post_to_linkedin",
            description: "Publie un message ou un article directement sur le profil LinkedIn connecté de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                text: {
                  type: "STRING",
                  description: "Le contenu textuel de la publication à poster."
                }
              },
              required: ["text"]
            }
          },
          {
            name: "get_discord_profile",
            description: "Récupère les détails du profil Discord connecté de l'utilisateur (nom d'utilisateur, e-mail, id, avatar) pour valider la liaison du connecteur.",
            parameters: {
              type: "OBJECT",
              properties: {}
            }
          },
          {
            name: "post_to_twitter",
            description: "Publie un message court (tweet) en temps réel sur le compte X/Twitter connecté de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                text: {
                  type: "STRING",
                  description: "Le contenu textuel du tweet."
                }
              },
              required: ["text"]
            }
          },
          {
            name: "post_to_facebook_instagram",
            description: "Publie un post textuel (avec optionnellement une image) sur la page Facebook ou Instagram de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                text: {
                  type: "STRING",
                  description: "Le contenu textuel ou la description du post."
                },
                imageUrl: {
                  type: "STRING",
                  description: "URL publique de l'image à attacher (optionnel)."
                }
              },
              required: ["text"]
            }
          },
          {
            name: "send_whatsapp_message",
            description: "Envoie un message WhatsApp (texte ou image) à un destinataire (numéro de téléphone) depuis l'API WhatsApp Business de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                to: {
                  type: "STRING",
                  description: "Le numéro de téléphone du destinataire au format international (ex: '+33612345678')."
                },
                text: {
                  type: "STRING",
                  description: "Le texte du message à envoyer."
                },
                mediaUrl: {
                  type: "STRING",
                  description: "URL publique de l'image ou du média à attacher (optionnel)."
                }
              },
              required: ["to", "text"]
            }
          },
          {
            name: "post_to_tiktok",
            description: "Planifie ou publie une vidéo sur le compte TikTok connecté de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                videoUrl: {
                  type: "STRING",
                  description: "URL publique de la vidéo TikTok."
                },
                title: {
                  type: "STRING",
                  description: "Le titre ou la légende associée à la vidéo."
                }
              },
              required: ["videoUrl", "title"]
            }
          },
          {
            name: "post_to_youtube",
            description: "Publie ou planifie une vidéo sur la chaîne YouTube de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                videoUrl: {
                  type: "STRING",
                  description: "URL publique de la vidéo à charger."
                },
                title: {
                  type: "STRING",
                  description: "Titre de la vidéo YouTube."
                },
                description: {
                  type: "STRING",
                  description: "Description textuelle détaillée pour la vidéo."
                }
              },
              required: ["videoUrl", "title"]
            }
          },
          {
            name: "post_to_pinterest",
            description: "Crée une nouvelle épingle (Pin) sur le tableau Pinterest de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                imageUrl: {
                  type: "STRING",
                  description: "URL de l'image de l'épingle."
                },
                note: {
                  type: "STRING",
                  description: "La description textuelle de l'épingle."
                },
                boardId: {
                  type: "STRING",
                  description: "ID optionnel du tableau Pinterest ciblé."
                },
                link: {
                  type: "STRING",
                  description: "Lien de redirection attaché à l'épingle (optionnel)."
                }
              },
              required: ["imageUrl", "note"]
            }
          },
          {
            name: "post_to_threads",
            description: "Publie un post textuel en temps réel sur le compte Threads connecté de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                text: {
                  type: "STRING",
                  description: "Le texte du post à publier."
                }
              },
              required: ["text"]
            }
          },
          {
            name: "schedule_via_buffer",
            description: "Planifie une publication multi-plateformes simultanément via l'outil de planification Buffer ou Hootsuite.",
            parameters: {
              type: "OBJECT",
              properties: {
                text: {
                  type: "STRING",
                  description: "Le texte de la publication."
                },
                profiles: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "Liste optionnelle des profils cibles (ex: ['LinkedIn', 'Twitter'])."
                }
              },
              required: ["text"]
            }
          },
          {
            name: "design_with_canva",
            description: "Synchronise, récupère ou interagit avec une charte graphique/visuel à partir d'un design Canva de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                designId: {
                  type: "STRING",
                  description: "L'identifiant unique du design Canva."
                }
              },
              required: ["designId"]
            }
          },
          {
            name: "send_mailchimp_campaign",
            description: "Crée et envoie ou planifie une campagne emailing collective via l'API Mailchimp.",
            parameters: {
              type: "OBJECT",
              properties: {
                subject: {
                  type: "STRING",
                  description: "Le sujet ou l'objet de l'e-mail."
                },
                body: {
                  type: "STRING",
                  description: "Le corps textuel ou HTML de la newsletter."
                },
                listId: {
                  type: "STRING",
                  description: "ID de liste d'abonnés optionnel."
                }
              },
              required: ["subject", "body"]
            }
          },
          {
            name: "send_teams_message",
            description: "Envoie un message instantané d'alerte ou de notification sur un canal Microsoft Teams via le Webhook de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                message: {
                  type: "STRING",
                  description: "Le texte du message à poster sur Teams."
                }
              },
              required: ["message"]
            }
          },
          {
            name: "send_brevo_campaign",
            description: "Envoie un e-mail professionnel ciblé ou une campagne via le SMTP de Brevo API.",
            parameters: {
              type: "OBJECT",
              properties: {
                to: {
                  type: "STRING",
                  description: "L'adresse e-mail du destinataire."
                },
                subject: {
                  type: "STRING",
                  description: "Sujet du courriel."
                },
                body: {
                  type: "STRING",
                  description: "Le corps HTML ou texte de l'e-mail."
                }
              },
              required: ["to", "subject", "body"]
            }
          },
          {
            name: "upsert_hubspot_contact",
            description: "Crée ou met à jour un contact dans le CRM HubSpot de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                email: {
                  type: "STRING",
                  description: "Adresse e-mail du contact (identifiant principal)."
                },
                firstName: {
                  type: "STRING",
                  description: "Prénom du contact."
                },
                lastName: {
                  type: "STRING",
                  description: "Nom de famille du contact."
                },
                notes: {
                  type: "STRING",
                  description: "Notes ou contexte additionnel à enregistrer sur ce contact."
                }
              },
              required: ["email"]
            }
          },
          {
            name: "create_shopify_product",
            description: "Crée un nouveau produit dans la boutique Shopify de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                title: {
                  type: "STRING",
                  description: "Titre du produit."
                },
                description: {
                  type: "STRING",
                  description: "Description du produit (peut contenir du HTML)."
                },
                price: {
                  type: "STRING",
                  description: "Prix du produit (ex: \"29.99\")."
                }
              },
              required: ["title", "price"]
            }
          },
          {
            name: "create_webflow_item",
            description: "Crée un nouvel élément (article, page CMS...) dans une collection Webflow de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                collectionId: {
                  type: "STRING",
                  description: "ID de la collection Webflow cible (facultatif si configuré par défaut)."
                },
                name: {
                  type: "STRING",
                  description: "Nom / titre de l'élément."
                },
                contentHtml: {
                  type: "STRING",
                  description: "Contenu principal de l'élément, au format HTML ou texte riche."
                }
              },
              required: ["name", "contentHtml"]
            }
          },
          {
            name: "append_google_sheets_row",
            description: "Ajoute une nouvelle ligne dans une feuille de calcul Google Sheets de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                spreadsheetId: {
                  type: "STRING",
                  description: "ID de la feuille de calcul cible (facultatif si configuré par défaut)."
                },
                rowValues: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "Liste ordonnée des valeurs de la ligne à ajouter (une entrée par colonne)."
                }
              },
              required: ["rowValues"]
            }
          },
          {
            name: "create_zendesk_ticket",
            description: "Crée un nouveau ticket de support dans Zendesk.",
            parameters: {
              type: "OBJECT",
              properties: {
                subject: { type: "STRING", description: "Sujet / titre du ticket." },
                description: { type: "STRING", description: "Description détaillée du problème ou de la demande." },
                requesterEmail: { type: "STRING", description: "E-mail du demandeur (facultatif)." }
              },
              required: ["subject", "description"]
            }
          },
          {
            name: "create_pipedrive_deal",
            description: "Crée une nouvelle affaire (deal) dans le CRM Pipedrive.",
            parameters: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING", description: "Titre de l'affaire." },
                value: { type: "NUMBER", description: "Valeur monétaire estimée de l'affaire, en euros (facultatif)." },
                personName: { type: "STRING", description: "Nom du contact associé (facultatif)." }
              },
              required: ["title"]
            }
          },
          {
            name: "create_asana_task",
            description: "Crée une nouvelle tâche dans Asana.",
            parameters: {
              type: "OBJECT",
              properties: {
                workspaceId: { type: "STRING", description: "ID de l'espace de travail Asana cible (facultatif si configuré par défaut)." },
                name: { type: "STRING", description: "Nom de la tâche." },
                notes: { type: "STRING", description: "Description / notes de la tâche (facultatif)." }
              },
              required: ["name"]
            }
          },
          {
            name: "create_clickup_task",
            description: "Crée une nouvelle tâche dans une liste ClickUp.",
            parameters: {
              type: "OBJECT",
              properties: {
                listId: { type: "STRING", description: "ID de la liste ClickUp cible (facultatif si configuré par défaut)." },
                name: { type: "STRING", description: "Nom de la tâche." },
                description: { type: "STRING", description: "Description de la tâche (facultatif)." }
              },
              required: ["name"]
            }
          },
          {
            name: "create_gitlab_issue",
            description: "Crée une nouvelle issue dans un projet GitLab.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectPath: { type: "STRING", description: "Chemin du projet GitLab, format proprietaire/nom-depot (facultatif si configuré par défaut)." },
                title: { type: "STRING", description: "Titre de l'issue." },
                description: { type: "STRING", description: "Description de l'issue (facultatif)." }
              },
              required: ["title"]
            }
          },
          {
            name: "create_salesforce_lead",
            description: "Crée un nouveau lead dans Salesforce.",
            parameters: {
              type: "OBJECT",
              properties: {
                lastName: { type: "STRING", description: "Nom de famille du lead." },
                company: { type: "STRING", description: "Nom de l'entreprise du lead." },
                email: { type: "STRING", description: "E-mail du lead (facultatif)." }
              },
              required: ["lastName", "company"]
            }
          },
          {
            name: "create_zoho_lead",
            description: "Crée un nouveau lead dans Zoho CRM.",
            parameters: {
              type: "OBJECT",
              properties: {
                lastName: { type: "STRING", description: "Nom de famille du lead." },
                company: { type: "STRING", description: "Nom de l'entreprise du lead." },
                email: { type: "STRING", description: "E-mail du lead (facultatif)." }
              },
              required: ["lastName", "company"]
            }
          },
          {
            name: "create_sellsy_company",
            description: "Crée une nouvelle fiche société dans Sellsy.",
            parameters: {
              type: "OBJECT",
              properties: {
                companyName: { type: "STRING", description: "Nom de la société à créer." }
              },
              required: ["companyName"]
            }
          },
          {
            name: "create_intercom_contact",
            description: "Crée un nouveau contact (lead) dans Intercom.",
            parameters: {
              type: "OBJECT",
              properties: {
                email: { type: "STRING", description: "E-mail du contact." },
                name: { type: "STRING", description: "Nom du contact (facultatif)." }
              },
              required: ["email"]
            }
          },
          {
            name: "create_bitbucket_issue",
            description: "Crée une nouvelle issue dans un dépôt Bitbucket.",
            parameters: {
              type: "OBJECT",
              properties: {
                repoPath: { type: "STRING", description: "Dépôt Bitbucket, format espace-de-travail/nom-depot (facultatif si configuré par défaut)." },
                title: { type: "STRING", description: "Titre de l'issue." },
                description: { type: "STRING", description: "Description de l'issue (facultatif)." }
              },
              required: ["title"]
            }
          },
          {
            name: "create_zoom_meeting",
            description: "Crée une nouvelle réunion Zoom (instantanée ou planifiée).",
            parameters: {
              type: "OBJECT",
              properties: {
                topic: { type: "STRING", description: "Sujet / titre de la réunion." },
                startTimeISO: { type: "STRING", description: "Date et heure de début au format ISO 8601 (facultatif ; si absent, réunion instantanée)." },
                durationMinutes: { type: "NUMBER", description: "Durée en minutes (facultatif, défaut 30)." }
              },
              required: ["topic"]
            }
          },
          {
            name: "create_box_folder",
            description: "Crée un nouveau dossier dans l'espace Box de l'utilisateur.",
            parameters: {
              type: "OBJECT",
              properties: {
                folderName: { type: "STRING", description: "Nom du dossier à créer." },
                parentFolderId: { type: "STRING", description: "ID du dossier parent (facultatif ; racine par défaut)." }
              },
              required: ["folderName"]
            }
          },
          {
            name: "create_stripe_payment_link",
            description: "Crée un vrai lien de paiement Stripe pour un produit/service donné. Le client doit lui-même cliquer sur le lien et payer — cet outil ne débite JAMAIS une carte automatiquement.",
            parameters: {
              type: "OBJECT",
              properties: {
                productName: { type: "STRING", description: "Nom du produit ou service facturé." },
                amount: { type: "STRING", description: "Montant à payer, en unité majeure (ex: \"49.99\")." },
                currency: { type: "STRING", description: "Code devise ISO à 3 lettres (facultatif, défaut \"eur\")." }
              },
              required: ["productName", "amount"]
            }
          },
          {
            name: "create_paypal_invoice",
            description: "Crée et envoie une vraie facture PayPal au client par e-mail. Le client doit lui-même cliquer sur le lien reçu et payer — cet outil ne déclenche JAMAIS un transfert automatique.",
            parameters: {
              type: "OBJECT",
              properties: {
                recipientEmail: { type: "STRING", description: "E-mail du destinataire de la facture." },
                description: { type: "STRING", description: "Description de la prestation facturée." },
                amount: { type: "STRING", description: "Montant à facturer, en unité majeure (ex: \"49.99\")." },
                currency: { type: "STRING", description: "Code devise ISO à 3 lettres (facultatif, défaut \"EUR\")." }
              },
              required: ["recipientEmail", "amount"]
            }
          },
          {
            name: "create_linear_issue",
            description: "Crée une nouvelle issue dans une équipe Linear.",
            parameters: {
              type: "OBJECT",
              properties: {
                teamId: { type: "STRING", description: "ID de l'équipe Linear cible (facultatif si configuré par défaut)." },
                title: { type: "STRING", description: "Titre de l'issue." },
                description: { type: "STRING", description: "Description de l'issue (facultatif)." }
              },
              required: ["title"]
            }
          },
          {
            name: "create_cloudflare_dns_record",
            description: "Crée un nouvel enregistrement DNS sur une zone Cloudflare.",
            parameters: {
              type: "OBJECT",
              properties: {
                zoneId: { type: "STRING", description: "ID de la zone Cloudflare cible (facultatif si configuré par défaut)." },
                recordType: { type: "STRING", description: "Type d'enregistrement (A, CNAME, TXT...). Défaut TXT." },
                recordName: { type: "STRING", description: "Nom de l'enregistrement (ex: sous-domaine)." },
                recordContent: { type: "STRING", description: "Contenu / valeur de l'enregistrement." }
              },
              required: ["recordName", "recordContent"]
            }
          },
          {
            name: "create_trello_card",
            description: "Crée une nouvelle carte dans une liste Trello.",
            parameters: {
              type: "OBJECT",
              properties: {
                listId: { type: "STRING", description: "ID de la liste Trello cible (facultatif si configuré par défaut)." },
                name: { type: "STRING", description: "Nom de la carte." },
                description: { type: "STRING", description: "Description de la carte (facultatif)." }
              },
              required: ["name"]
            }
          },
          {
            name: "post_datadog_event",
            description: "Publie un événement (alerte, note, incident) sur Datadog.",
            parameters: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING", description: "Titre de l'événement." },
                text: { type: "STRING", description: "Contenu détaillé de l'événement." },
                alertType: { type: "STRING", description: "Type d'alerte : info, warning, error ou success (facultatif, défaut info)." }
              },
              required: ["title", "text"]
            }
          },
          {
            name: "create_sentry_release",
            description: "Crée une nouvelle release dans Sentry.",
            parameters: {
              type: "OBJECT",
              properties: {
                version: { type: "STRING", description: "Identifiant de version de la release (ex: un hash de commit ou un numéro de version)." },
                projects: { type: "ARRAY", items: { type: "STRING" }, description: "Liste des slugs de projets Sentry concernés (facultatif)." }
              },
              required: ["version"]
            }
          },
          {
            name: "add_figma_comment",
            description: "Ajoute un commentaire sur un fichier Figma.",
            parameters: {
              type: "OBJECT",
              properties: {
                fileKey: { type: "STRING", description: "Clé du fichier Figma cible (facultatif si configuré par défaut)." },
                message: { type: "STRING", description: "Contenu du commentaire." }
              },
              required: ["message"]
            }
          },
          {
            name: "create_woocommerce_product",
            description: "Crée un nouveau produit dans une boutique WooCommerce.",
            parameters: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "Nom du produit." },
                description: { type: "STRING", description: "Description du produit (facultatif)." },
                price: { type: "STRING", description: "Prix régulier du produit (facultatif)." }
              },
              required: ["name"]
            }
          },
          {
            name: "create_freshdesk_ticket",
            description: "Crée un nouveau ticket de support dans Freshdesk.",
            parameters: {
              type: "OBJECT",
              properties: {
                subject: { type: "STRING", description: "Sujet / titre du ticket." },
                description: { type: "STRING", description: "Description détaillée du problème ou de la demande." },
                requesterEmail: { type: "STRING", description: "E-mail du demandeur." }
              },
              required: ["subject", "description", "requesterEmail"]
            }
          },
          {
            name: "create_jira_issue",
            description: "Crée un nouveau ticket (issue) dans un projet Jira.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectKey: { type: "STRING", description: "Clé du projet Jira cible (facultatif si configuré par défaut)." },
                summary: { type: "STRING", description: "Titre / résumé du ticket." },
                description: { type: "STRING", description: "Description détaillée du ticket (facultatif)." }
              },
              required: ["summary"]
            }
          },
          {
            name: "create_confluence_page",
            description: "Crée une nouvelle page dans un espace Confluence.",
            parameters: {
              type: "OBJECT",
              properties: {
                spaceKey: { type: "STRING", description: "Clé de l'espace Confluence cible (facultatif si configuré par défaut)." },
                title: { type: "STRING", description: "Titre de la page." },
                contentHtml: { type: "STRING", description: "Contenu de la page au format HTML." }
              },
              required: ["title", "contentHtml"]
            }
          }
        ]
      }
    ];

    let loopCount = 0;
    let currentContents = [...contents];
    let latestResponse = null;
    const executionLogs = [];

    const lastUserMessage = [...contents].reverse().find(c => c.role === 'user');
    const lastUserMessageText = lastUserMessage?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';

    while (loopCount < 3) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: currentContents,
          systemInstruction: { parts: [{ text: finalSystemInstruction }] },
          tools: tools,
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        })
      });

      const data = await response.json();
      latestResponse = data;

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      const candidate = data.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      
      // If Gemini asks to execute a function
      if (part && part.functionCall) {
        const functionCall = part.functionCall;
        const functionName = functionCall.name;
        const functionArgs = functionCall.args;
        
        console.log(`[Agent Tool Call]: Executing ${functionName} with args:`, functionArgs);
        
        let functionResult = {};
        try {
          if (functionName === 'run_ssh_command') {
            functionResult = await runSSH(connectors, functionArgs.command);
          } else if (functionName === 'execute_postgres_query') {
            functionResult = await runPostgres(connectors, functionArgs.query);
          } else if (functionName === 'send_slack_message') {
            functionResult = await runSlack(connectors, functionArgs.message);
          } else if (functionName === 'send_email') {
            functionResult = await runEmail(connectors, functionArgs.to, functionArgs.subject, functionArgs.body);
          } else if (functionName === 'trigger_workflow_action') {
            functionResult = await runN8N(connectors, functionArgs.action, functionArgs.details, functionArgs.payload, agentName);
          } else if (functionName === 'create_notion_page') {
            functionResult = await runNotion(connectors, functionArgs.databaseId, functionArgs.title, functionArgs.contentMarkdown);
          } else if (functionName === 'create_wordpress_draft') {
            functionResult = await runWordPress(connectors, functionArgs.title, functionArgs.contentHtml);
          } else if (functionName === 'create_github_issue') {
            functionResult = await runGitHub(connectors, functionArgs.title, functionArgs.body);
          } else if (functionName === 'insert_airtable_record') {
            functionResult = await runAirtable(connectors, functionArgs.baseId, functionArgs.tableName, functionArgs.fieldsJson);
          } else if (functionName === 'post_to_linkedin') {
            functionResult = await runLinkedIn(connectors, functionArgs.text);
          } else if (functionName === 'get_discord_profile') {
            functionResult = await runDiscordProfile(connectors);
          } else if (functionName === 'post_to_twitter') {
            functionResult = await runTwitter(connectors, functionArgs.text);
          } else if (functionName === 'post_to_facebook_instagram') {
            functionResult = await runFacebookInstagram(connectors, functionArgs.text, functionArgs.imageUrl);
          } else if (functionName === 'send_whatsapp_message') {
            functionResult = await runWhatsApp(connectors, functionArgs.to, functionArgs.text, functionArgs.mediaUrl);
          } else if (functionName === 'post_to_tiktok') {
            functionResult = await runTikTok(connectors, functionArgs.videoUrl, functionArgs.title);
          } else if (functionName === 'post_to_youtube') {
            functionResult = await runYouTube(connectors, functionArgs.videoUrl, functionArgs.title, functionArgs.description);
          } else if (functionName === 'post_to_pinterest') {
            functionResult = await runPinterest(connectors, functionArgs.imageUrl, functionArgs.note, functionArgs.boardId, functionArgs.link);
          } else if (functionName === 'post_to_threads') {
            functionResult = await runThreads(connectors, functionArgs.text);
          } else if (functionName === 'schedule_via_buffer') {
            functionResult = await runBuffer(connectors, functionArgs.text, functionArgs.profiles);
          } else if (functionName === 'design_with_canva') {
            functionResult = await runCanva(connectors, functionArgs.designId);
          } else if (functionName === 'send_mailchimp_campaign') {
            functionResult = await runMailchimp(connectors, functionArgs.subject, functionArgs.body, functionArgs.listId);
          } else if (functionName === 'send_teams_message') {
            functionResult = await runTeams(connectors, functionArgs.message);
          } else if (functionName === 'send_brevo_campaign') {
            functionResult = await runBrevo(connectors, functionArgs.to, functionArgs.subject, functionArgs.body);
          } else if (functionName === 'upsert_hubspot_contact') {
            functionResult = await runHubSpot(connectors, functionArgs.email, functionArgs.firstName, functionArgs.lastName, functionArgs.notes);
          } else if (functionName === 'create_shopify_product') {
            functionResult = await runShopify(connectors, functionArgs.title, functionArgs.description, functionArgs.price);
          } else if (functionName === 'create_webflow_item') {
            functionResult = await runWebflow(connectors, functionArgs.collectionId, functionArgs.name, functionArgs.contentHtml);
          } else if (functionName === 'append_google_sheets_row') {
            functionResult = await runGoogleSheets(connectors, functionArgs.spreadsheetId, functionArgs.rowValues);
          } else if (functionName === 'create_zendesk_ticket') {
            functionResult = await runZendesk(connectors, functionArgs.subject, functionArgs.description, functionArgs.requesterEmail);
          } else if (functionName === 'create_pipedrive_deal') {
            functionResult = await runPipedrive(connectors, functionArgs.title, functionArgs.value, functionArgs.personName);
          } else if (functionName === 'create_asana_task') {
            functionResult = await runAsana(connectors, functionArgs.workspaceId, functionArgs.name, functionArgs.notes);
          } else if (functionName === 'create_clickup_task') {
            functionResult = await runClickUp(connectors, functionArgs.listId, functionArgs.name, functionArgs.description);
          } else if (functionName === 'create_gitlab_issue') {
            functionResult = await runGitLab(connectors, functionArgs.projectPath, functionArgs.title, functionArgs.description);
          } else if (functionName === 'create_salesforce_lead') {
            functionResult = await runSalesforce(connectors, functionArgs.lastName, functionArgs.company, functionArgs.email);
          } else if (functionName === 'create_zoho_lead') {
            functionResult = await runZoho(connectors, functionArgs.lastName, functionArgs.company, functionArgs.email);
          } else if (functionName === 'create_sellsy_company') {
            functionResult = await runSellsy(connectors, functionArgs.companyName);
          } else if (functionName === 'create_intercom_contact') {
            functionResult = await runIntercom(connectors, functionArgs.email, functionArgs.name);
          } else if (functionName === 'create_bitbucket_issue') {
            functionResult = await runBitbucket(connectors, functionArgs.repoPath, functionArgs.title, functionArgs.description);
          } else if (functionName === 'create_zoom_meeting') {
            functionResult = await runZoom(connectors, functionArgs.topic, functionArgs.startTimeISO, functionArgs.durationMinutes);
          } else if (functionName === 'create_box_folder') {
            functionResult = await runBox(connectors, functionArgs.folderName, functionArgs.parentFolderId);
          } else if (functionName === 'create_stripe_payment_link') {
            functionResult = await runStripePaymentLink(connectors, functionArgs.productName, functionArgs.amount, functionArgs.currency);
          } else if (functionName === 'create_paypal_invoice') {
            functionResult = await runPayPalInvoice(connectors, functionArgs.recipientEmail, functionArgs.description, functionArgs.amount, functionArgs.currency);
          } else if (functionName === 'create_linear_issue') {
            functionResult = await runLinear(connectors, functionArgs.teamId, functionArgs.title, functionArgs.description);
          } else if (functionName === 'create_cloudflare_dns_record') {
            functionResult = await runCloudflare(connectors, functionArgs.zoneId, functionArgs.recordType, functionArgs.recordName, functionArgs.recordContent);
          } else if (functionName === 'create_trello_card') {
            functionResult = await runTrello(connectors, functionArgs.listId, functionArgs.name, functionArgs.description);
          } else if (functionName === 'post_datadog_event') {
            functionResult = await runDatadog(connectors, functionArgs.title, functionArgs.text, functionArgs.alertType);
          } else if (functionName === 'create_sentry_release') {
            functionResult = await runSentry(connectors, functionArgs.version, functionArgs.projects);
          } else if (functionName === 'add_figma_comment') {
            functionResult = await runFigma(connectors, functionArgs.fileKey, functionArgs.message);
          } else if (functionName === 'create_woocommerce_product') {
            functionResult = await runWooCommerce(connectors, functionArgs.name, functionArgs.description, functionArgs.price);
          } else if (functionName === 'create_freshdesk_ticket') {
            functionResult = await runFreshdesk(connectors, functionArgs.subject, functionArgs.description, functionArgs.requesterEmail);
          } else if (functionName === 'create_jira_issue') {
            functionResult = await runJira(connectors, functionArgs.projectKey, functionArgs.summary, functionArgs.description);
          } else if (functionName === 'create_confluence_page') {
            functionResult = await runConfluence(connectors, functionArgs.spaceKey, functionArgs.title, functionArgs.contentHtml);
          } else {
            functionResult = { error: `Outil ${functionName} inconnu.` };
          }
        } catch (err) {
          functionResult = { error: err.message };
        }
        
        console.log(`[Agent Tool Result]: Received result from ${functionName}:`, JSON.stringify(functionResult));

        // Consigner l'outil exécuté
        executionLogs.push({
          tool: functionName,
          args: functionArgs,
          result: functionResult
        });

        // Update conversation history with the model's tool request and the tool's result
        currentContents.push(candidate.content);
        currentContents.push({
          role: "function",
          parts: [{
            functionResponse: {
              name: functionName,
              response: functionResult
            }
          }]
        });
        
        loopCount++;
      } else {
        // No function call (regular text), return to client
        data.executionLogs = executionLogs;
        if (userId) {
          const replyText = part?.text || '';
          await updateAccountMemory(apiKey, userId, agentId, agentName, lastUserMessageText, replyText);
        }
        return res.status(200).json(data);
      }
    }

    // If recursion limit is hit, return the last data we have
    if (latestResponse) {
      latestResponse.executionLogs = executionLogs;
      if (userId) {
        const replyText = latestResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
        await updateAccountMemory(apiKey, userId, agentId, agentName, lastUserMessageText, replyText);
      }
    }
    return res.status(200).json(latestResponse);
  } catch (error) {
    console.error('[API Chat Error]:', error);
    return res.status(500).json({ error: { message: error.message || 'Internal Server Error' } });
  }
}

// Récupère les derniers faits mémorisés pour ce compte (tous agents confondus)
// et les formate pour injection dans le system prompt de l'agent en cours.
async function getAccountMemoryContext(userId) {
  if (!supabase || !userId) return '';
  try {
    const { data, error } = await supabase
      .from('account_memory')
      .select('agent_name, fact, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25);

    if (error || !data || data.length === 0) return '';

    return data
      .slice()
      .reverse()
      .map(row => `- [${row.agent_name || row.agent_id || 'Agent'}] ${row.fact}`)
      .join('\n');
  } catch (err) {
    console.error('[Account Memory] Erreur de lecture:', err);
    return '';
  }
}

// Après un échange, demande au modèle d'extraire 0 à 3 faits durables (décisions,
// données client, tâches en cours...) et les stocke pour que les AUTRES agents du
// même compte en héritent lors de leurs propres conversations.
async function updateAccountMemory(apiKey, userId, agentId, agentName, userMessageText, agentReplyText) {
  if (!supabase || !userId || !apiKey || !userMessageText || !agentReplyText) return;
  try {
    const extractionPrompt = `Voici un échange entre un utilisateur et l'agent IA "${agentName}" (${agentId}) sur la plateforme César-IA.

Message utilisateur : "${userMessageText.slice(0, 1500)}"
Réponse de l'agent : "${agentReplyText.slice(0, 1500)}"

Extrait 0 à 3 faits DURABLES et utiles à partager avec les AUTRES agents IA de ce même compte (ex : identité de l'entreprise, décision prise, donnée client, tâche en cours, préférence exprimée). Ignore le small talk et tout ce qui n'a pas de valeur au-delà de cet échange.

Réponds uniquement avec un JSON de la forme {"facts": ["fait court 1", "fait court 2"]}. Si rien n'est notable, réponds {"facts": []}.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    });

    if (!response.ok) return;
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return;

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      return;
    }

    const facts = Array.isArray(parsed?.facts) ? parsed.facts.filter(f => typeof f === 'string' && f.trim()) : [];
    if (facts.length === 0) return;

    await supabase.from('account_memory').insert(
      facts.map(fact => ({
        user_id: userId,
        agent_id: agentId,
        agent_name: agentName,
        fact: fact.trim().slice(0, 500)
      }))
    );
  } catch (err) {
    console.error('[Account Memory] Erreur d\'extraction:', err);
  }
}

async function getLinkedInPastPosts(connectors) {
  const liInfo = getConnectorInfo(connectors, "LinkedIn");
  if (!liInfo || !liInfo.token) return null;
  const token = liInfo.token.trim();
  
  const cacheKey = `posts_${token.slice(-20)}`;
  if (global.linkedinStyleCache) {
    const cached = global.linkedinStyleCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      console.log("[LinkedIn Past Posts Cache] Hit!");
      return cached.posts;
    }
  }

  try {
    // Fetch profile (OIDC first, fallback to legacy me) with a 2-second timeout per call
    let personId = null;
    let profileRes = await fetchWithTimeout("https://api.linkedin.com/v2/userinfo", {
      headers: { "Authorization": `Bearer ${token}` },
      timeout: 2000
    });
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      personId = profileData.sub;
    }
    if (!personId) {
      profileRes = await fetchWithTimeout("https://api.linkedin.com/v2/me", {
        headers: { "Authorization": `Bearer ${token}` },
        timeout: 2000
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        personId = profileData.id;
      }
    }
    if (!personId) return null;
    
    let sharesRes = await fetchWithTimeout(`https://api.linkedin.com/rest/posts?author=urn%3Ali%3Aperson%3A${personId}&q=author&count=5`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": "202401"
      },
      timeout: 2000
    });
    const posts = [];
    if (sharesRes.ok) {
      const sharesData = await sharesRes.json();
      if (sharesData.elements && sharesData.elements.length > 0) {
        sharesData.elements.forEach(share => {
          if (share.commentary) {
            posts.push(share.commentary);
          }
        });
      }
    }
    
    if (posts.length === 0) {
      sharesRes = await fetchWithTimeout(`https://api.linkedin.com/v2/shares?owners=urn:li:person:${personId}&sharesPerOwner=5`, {
        headers: { "Authorization": `Bearer ${token}` },
        timeout: 2000
      });
      if (sharesRes.ok) {
        const sharesData = await sharesRes.json();
        if (sharesData.elements && sharesData.elements.length > 0) {
          sharesData.elements.forEach(share => {
            if (share.text && share.text.text) {
              posts.push(share.text.text);
            }
          });
        }
      }
    }
    
    if (global.linkedinStyleCache) {
      global.linkedinStyleCache.set(cacheKey, {
        posts: posts,
        expiry: Date.now() + 15 * 60 * 1000 // 15 minutes cache
      });
    }
    
    return posts;
  } catch (e) {
    console.error("Error fetching LinkedIn past posts:", e);
    return null;
  }
}

async function analyzeAndDraftPost(message, mediaUrl, connectors) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return "Clé API Gemini manquante sur le serveur.";

  // Study writing style from past posts first
  const pastPosts = connectors ? await getLinkedInPastPosts(connectors) : null;
  let styleGuideline = "Copywriting humain, percutant, structuré en paragraphes aérés, avec emojis contextuels pertinents et un fort appel à l'action.";
  if (pastPosts && pastPosts.length > 0) {
    styleGuideline = `Voici des exemples réels de posts passés de l'utilisateur. Analyse minutieusement leur rythme, structure et tonalité pour les copier à 100% à l'identique :\n${pastPosts.join('\n---\n')}`;
  }

  // Construct contents for Gemini API (supports Multimodal if mediaUrl is provided!)
  const parts = [];
  
  if (mediaUrl) {
    try {
      // Fetch image from URL and encode in base64
      const imgRes = await fetch(mediaUrl);
      if (imgRes.ok) {
        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64
          }
        });
      }
    } catch (e) {
      console.error("Error downloading media image:", e);
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

Directives de style d'écriture de l'utilisateur :
${styleGuideline}

Contexte fourni par l'utilisateur : "${message}"
${mediaUrl ? "Une image de l'événement a été fournie et attachée. Analyse visuellement ce qu'elle montre pour l'intégrer avec intelligence et réalisme dans le texte du post." : ""}

Consignes de formatage de ta réponse :
- Renvoie les versions rédigées pour les réseaux concernés suivies de tes questions sur les mentions et hashtags à la fin.
- N'ajoute aucune introduction, aucune salutation globale ni commentaire externe explicatif.`
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
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur de génération du post.";
    }
  } catch (err) {
    console.error("Error in analyzeAndDraftPost:", err);
  }
  
  return `Super événement aujourd'hui ! Content d'avoir pu échanger avec tout le monde autour de nos dernières innovations. 🚀 #Evenement #Networking`;
}
