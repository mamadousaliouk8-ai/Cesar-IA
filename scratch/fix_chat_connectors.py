import re

file_path = '/Users/manelcheraiti/saliou/plateforme-agents-ia/api/chat.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add getConnectorInfo function definition before the helper executors comments
helper_def = """
// Safe helper to extract connector info from connectors object by name or partial name key
function getConnectorInfo(connectors, name) {
  if (!connectors) return null;
  if (connectors[name]) return connectors[name];
  const entry = Object.entries(connectors).find(([k]) => k && typeof k === 'string' && k.toLowerCase().includes(name.toLowerCase()));
  return entry ? entry[1] : null;
}

// Helper executors for tools"""

content = content.replace('// Helper executors for tools', helper_def)

# 2. Perform replacements for all connectors lookup bugs
replacements = {
    'const connInfo = connectors["Serveur SSH"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("SSH"));': 
        'const connInfo = getConnectorInfo(connectors, "SSH");',
        
    'const dbInfo = connectors["PostgreSQL/MySQL/SQL Server"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && (k.includes("PostgreSQL") || k.includes("Database")));':
        'const dbInfo = connectors["PostgreSQL/MySQL/SQL Server"] || getConnectorInfo(connectors, "PostgreSQL") || getConnectorInfo(connectors, "Database") || getConnectorInfo(connectors, "SQL");',
        
    'const slackInfo = connectors["Slack"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Slack"));':
        'const slackInfo = getConnectorInfo(connectors, "Slack");',
        
    'const discordInfo = connectors["Discord"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Discord"));':
        'const discordInfo = getConnectorInfo(connectors, "Discord");',
        
    'const brevoInfo = connectors["Brevo API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Brevo"));':
        'const brevoInfo = getConnectorInfo(connectors, "Brevo");',
        
    'const n8nInfo = connectors["n8n Webhook"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("n8n"));':
        'const n8nInfo = getConnectorInfo(connectors, "n8n");',
        
    'const notionInfo = connectors["Notion"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Notion"));':
        'const notionInfo = getConnectorInfo(connectors, "Notion");',
        
    'const wpInfo = connectors["WordPress"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("WordPress"));':
        'const wpInfo = getConnectorInfo(connectors, "WordPress");',
        
    'const ghInfo = connectors["GitHub"] || connectors["GitHub Actions"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("GitHub"));':
        'const ghInfo = getConnectorInfo(connectors, "GitHub");',
        
    'const airtableInfo = connectors["Airtable"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Airtable"));':
        'const airtableInfo = getConnectorInfo(connectors, "Airtable");',
        
    'const liInfo = connectors["LinkedIn API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("LinkedIn"));':
        'const liInfo = getConnectorInfo(connectors, "LinkedIn");',
        
    'const info = connectors["X/Twitter API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Twitter"));':
        'const info = getConnectorInfo(connectors, "Twitter");',
        
    'const info = connectors["Instagram/Facebook API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && (k.includes("Facebook") || k.includes("Instagram")));':
        'const info = getConnectorInfo(connectors, "Facebook") || getConnectorInfo(connectors, "Instagram");',
        
    'const info = connectors["WhatsApp Business API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("WhatsApp"));':
        'const info = getConnectorInfo(connectors, "WhatsApp");',
        
    'const info = connectors["TikTok API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("TikTok"));':
        'const info = getConnectorInfo(connectors, "TikTok");',
        
    'const info = connectors["YouTube API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("YouTube"));':
        'const info = getConnectorInfo(connectors, "YouTube");',
        
    'const info = connectors["Pinterest API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Pinterest"));':
        'const info = getConnectorInfo(connectors, "Pinterest");',
        
    'const info = connectors["Threads API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Threads"));':
        'const info = getConnectorInfo(connectors, "Threads");',
        
    'const info = connectors["Buffer/Hootsuite"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && (k.includes("Buffer") || k.includes("Hootsuite")));':
        'const info = getConnectorInfo(connectors, "Buffer") || getConnectorInfo(connectors, "Hootsuite");',
        
    'const info = connectors["Canva API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Canva"));':
        'const info = getConnectorInfo(connectors, "Canva");',
        
    'const info = connectors["Mailchimp API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Mailchimp"));':
        'const info = getConnectorInfo(connectors, "Mailchimp");',
        
    'const info = connectors["Microsoft Teams"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Teams"));':
        'const info = getConnectorInfo(connectors, "Teams");',
        
    'const info = connectors["Brevo API"] || Object.values(connectors).find((v, k) => k && typeof k === \'string\' && k.includes("Brevo"));':
        'const info = getConnectorInfo(connectors, "Brevo");'
}

for src, dst in replacements.items():
    content = content.replace(src, dst)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Replacement complete successfully.")
