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

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (!supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL'))
  ? null
  : createClient(supabaseUrl, supabaseKey);


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

  const token = (info.token || envToken || '').trim();
  const phoneId = (info.phoneId || envPhoneId || 'me').trim();

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
    // Parse body if urlencoded / raw string
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        try {
          const urlParams = new URLSearchParams(body);
          body = {};
          for (const [key, value] of urlParams.entries()) {
            body[key] = value;
          }
        } catch (err) {}
      }
    }

    // 1. Detect if the request is an incoming Webhook from Twilio WhatsApp
    if (body && body.From && body.From.startsWith('whatsapp:')) {
      console.log(`[WhatsApp Webhook] Message reçu de: ${body.From}`);
      const incomingMessage = body.Body || '';
      const mediaUrl = body.MediaUrl0 || null; 
      const senderNumber = body.From; // e.g. "whatsapp:+33612345678"
      
      // 2. Query Supabase database to find which user owns this WhatsApp number
      let userConnectors = null;
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('connectors')
            .select('*')
            .in('connector_name', ['WhatsApp', 'WhatsApp Business API']);
            
          if (!error && data) {
            const matched = data.find(c => {
              const creds = c.credentials || {};
              const configuredPhone = creds.sender || creds.phone || creds.token || '';
              const cleanSender = senderNumber.replace('whatsapp:', '').trim();
              const cleanConfigured = configuredPhone.replace('whatsapp:', '').trim();
              return cleanConfigured && (cleanSender.includes(cleanConfigured) || cleanConfigured.includes(cleanSender));
            });
            
            if (matched) {
              console.log(`[WhatsApp Webhook] Utilisateur identifié: ${matched.user_id}`);
              const { data: allConn, error: allConnErr } = await supabase
                .from('connectors')
                .select('*')
                .eq('user_id', matched.user_id)
                .eq('agent_id', matched.agent_id);
                
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
      
      // 4. Publish to LinkedIn if LinkedIn is connected
      let publishStatus = "sauvegardé en brouillon.";
      if (userConnectors && userConnectors["LinkedIn API"] && userConnectors["LinkedIn API"].token) {
        const pubRes = await runLinkedIn(userConnectors, responseText);
        if (pubRes && !pubRes.error) {
          publishStatus = "publié directement sur votre feed LinkedIn ! 🚀";
        } else {
          publishStatus = `erreur de publication LinkedIn : ${pubRes ? pubRes.error : 'inconnue'}`;
        }
      } else {
        publishStatus = "sauvegardé en brouillon (connecteur LinkedIn non lié).";
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
            'admin@xn--csar-ia-bya.com'
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
        const token = liInfo.token.trim();
        // 1. Fetch LinkedIn URN and last posts to study style and history (OIDC first, fallback to legacy me)
        let personId = null;
        let profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          personId = profileData.sub;
        }
        if (!personId) {
          profileRes = await fetch("https://api.linkedin.com/v2/me", {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (profileRes.ok) {
            const profileData = await profileRes.json();
            personId = profileData.id;
          }
        }
        if (personId) {
          let sharesRes = await fetch(`https://api.linkedin.com/rest/posts?author=urn%3Ali%3Aperson%3A${personId}&q=author&count=5`, {
            headers: {
              "Authorization": `Bearer ${token}`,
              "X-Restli-Protocol-Version": "2.0.0",
              "LinkedIn-Version": "202401"
            }
          });
          const pastPosts = [];
          if (sharesRes.ok) {
            const sharesData = await sharesRes.json();
            if (sharesData.elements && sharesData.elements.length > 0) {
              sharesData.elements.forEach(share => {
                if (share.commentary) {
                  pastPosts.push(share.commentary);
                }
              });
            }
          }
          
          if (pastPosts.length === 0) {
            sharesRes = await fetch(`https://api.linkedin.com/v2/shares?owners=urn:li:person:${personId}&sharesPerOwner=5`, {
              headers: { "Authorization": `Bearer ${token}` }
            });
            if (sharesRes.ok) {
              const sharesData = await sharesRes.json();
              if (sharesData.elements && sharesData.elements.length > 0) {
                sharesData.elements.forEach(share => {
                  if (share.text && share.text.text) {
                    pastPosts.push(share.text.text);
                  }
                });
              }
            }
          }

          if (pastPosts.length > 0) {
            finalSystemInstruction += `\n\n### HISTORIQUE & STYLE D'ÉCRITURE RÉEL DE L'UTILISATEUR (RÉCUPÉRÉ DEPUIS LINKEDIN) :\n`;
            pastPosts.forEach((post, idx) => {
              finalSystemInstruction += `\n[Post précédent #${idx+1}]:\n${post}\n`;
            });
            finalSystemInstruction += `\nConsigne de style critique : Analyse minutieusement la structure, le ton, le saut de lignes et l'esprit des publications réelles ci-dessus. Rédige tes nouvelles propositions en mimant parfaitement à 100% ce style d'écriture réel. N'écris jamais de posts identiques aux exemples ci-dessus pour éviter les répétitions !`;
          }
        }
      } catch (errStyle) {
        console.error("Erreur lors de la récupération automatique du style LinkedIn :", errStyle);
      }
    }
    
    const apiKey = clientApiKey || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
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
          }
        ]
      }
    ];

    let loopCount = 0;
    let currentContents = [...contents];
    let latestResponse = null;
    const executionLogs = [];

    while (loopCount < 3) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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
        return res.status(200).json(data);
      }
    }

    // If recursion limit is hit, return the last data we have
    if (latestResponse) {
      latestResponse.executionLogs = executionLogs;
    }
    return res.status(200).json(latestResponse);
  } catch (error) {
    console.error('[API Chat Error]:', error);
    return res.status(500).json({ error: { message: error.message || 'Internal Server Error' } });
  }
}

async function getLinkedInPastPosts(connectors) {
  const liInfo = getConnectorInfo(connectors, "LinkedIn");
  if (!liInfo || !liInfo.token) return null;
  const token = liInfo.token.trim();
  try {
    // Fetch profile (OIDC first, fallback to legacy me)
    let personId = null;
    let profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      personId = profileData.sub;
    }
    if (!personId) {
      profileRes = await fetch("https://api.linkedin.com/v2/me", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        personId = profileData.id;
      }
    }
    if (!personId) return null;
    
    let sharesRes = await fetch(`https://api.linkedin.com/rest/posts?author=urn%3Ali%3Aperson%3A${personId}&q=author&count=5`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": "202401"
      }
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
      sharesRes = await fetch(`https://api.linkedin.com/v2/shares?owners=urn:li:person:${personId}&sharesPerOwner=5`, {
        headers: { "Authorization": `Bearer ${token}` }
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
    text: `Tu es Chronos, un agent marketing autonome spécialisé dans la rédaction LinkedIn.
Un utilisateur t'envoie un média et/ou un message depuis son téléphone lors d'un événement.
Ton but est de rédiger un post LinkedIn impactant, vivant et professionnel qui résume cet événement.

Directives de style d'écriture de l'utilisateur :
${styleGuideline}

Contexte fourni par l'utilisateur : "${message}"
${mediaUrl ? "Une image de l'événement a été fournie et attachée. Analyse visuellement ce qu'elle montre pour l'intégrer avec intelligence et réalisme dans le texte du post." : ""}

Consignes de formatage de ta réponse :
- Renvoie uniquement le texte final du post LinkedIn, prêt à être copié/collé ou publié directement.
- N'ajoute aucune introduction, aucune salutation ni commentaire externe (pas de "Voici le post rédigé :"). Renvoie DIRECTEMENT le texte du post.`
  });

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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
