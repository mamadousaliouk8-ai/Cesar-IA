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

// Helper executors for tools
async function runSSH(connectors, command) {
  const connInfo = connectors["Serveur SSH"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("SSH"));
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
  const dbInfo = connectors["PostgreSQL/MySQL/SQL Server"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && (k.includes("PostgreSQL") || k.includes("Database")));
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
  const slackInfo = connectors["Slack"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("Slack"));
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

async function runEmail(connectors, to, subject, body) {
  const brevoInfo = connectors["Brevo API"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("Brevo"));
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
  const n8nInfo = connectors["n8n Webhook"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("n8n"));
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
  const notionInfo = connectors["Notion"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("Notion"));
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
  const wpInfo = connectors["WordPress"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("WordPress"));
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
  const ghInfo = connectors["GitHub"] || connectors["GitHub Actions"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("GitHub"));
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
  const airtableInfo = connectors["Airtable"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("Airtable"));
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
    const { contents, systemInstruction, apiKey: clientApiKey, connectors = {}, agentName = 'César-IA Agent' } = req.body;
    
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
          }
        ]
      }
    ];

    let loopCount = 0;
    let currentContents = [...contents];
    let latestResponse = null;

    while (loopCount < 3) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: currentContents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
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
          } else {
            functionResult = { error: `Outil ${functionName} inconnu.` };
          }
        } catch (err) {
          functionResult = { error: err.message };
        }
        
        console.log(`[Agent Tool Result]: Received result from ${functionName}`);

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
        return res.status(200).json(data);
      }
    }

    // If recursion limit is hit, return the last data we have
    return res.status(200).json(latestResponse);
  } catch (error) {
    console.error('[API Chat Error]:', error);
    return res.status(500).json({ error: { message: error.message || 'Internal Server Error' } });
  }
}
