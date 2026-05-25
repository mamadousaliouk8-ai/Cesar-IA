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

// Helper executors for tools
async function runSSH(connectors, command) {
  const connInfo = connectors["Serveur SSH"] || Object.values(connectors).find((v, k) => k && typeof k === 'string' && k.includes("SSH"));
  if (!connInfo || !connInfo.host || !connInfo.user) {
    return { error: "Erreur: Le connecteur SSH n'est pas configuré. Veuillez renseigner l'hôte et l'utilisateur dans l'onglet Connecteurs." };
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
      conn.exec(command, (err, stream) => {
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
  
  const cleanQuery = query.trim();
  if (!/^(select|show|explain|describe)\s/i.test(cleanQuery)) {
    return { error: "Action refusée pour des raisons de sécurité : Seules les requêtes de lecture (SELECT, SHOW, EXPLAIN, DESCRIBE) sont autorisées sur la base de données." };
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
    const { contents, systemInstruction, apiKey: clientApiKey, connectors = {} } = req.body;
    
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
          }
        ]
      }
    ];

    let loopCount = 0;
    let currentContents = [...contents];
    let latestResponse = null;

    while (loopCount < 3) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
