const SVG_SLIDERS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <line x1="6" y1="13" x2="42" y2="13" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
  <line x1="6" y1="24" x2="42" y2="24" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
  <line x1="6" y1="35" x2="42" y2="35" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
  <circle cx="17" cy="13" r="4.5" stroke="#D4AF37" stroke-width="1.5" fill="#0B0B0F"/>
  <circle cx="31" cy="24" r="4.5" stroke="#D4AF37" stroke-width="1.5" fill="#0B0B0F"/>
  <circle cx="21" cy="35" r="4.5" stroke="#D4AF37" stroke-width="1.5" fill="#0B0B0F"/>
</svg>`;

const SVG_CHART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <rect x="5" y="7" width="38" height="26" rx="2.5" stroke="#D4AF37" stroke-width="1.5"/>
  <line x1="5" y1="28" x2="43" y2="28" stroke="#D4AF37" stroke-width="1" opacity="0.3"/>
  <polyline points="10,24 17,16 24,20 33,11 40,14" stroke="#D4AF37" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="33" cy="11" r="2" fill="#D4AF37"/>
  <line x1="20" y1="33" x2="20" y2="39" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="28" y1="33" x2="28" y2="39" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="12" y1="39" x2="36" y2="39" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const SVG_TARGET = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <circle cx="22" cy="26" r="16" stroke="#D4AF37" stroke-width="1.5"/>
  <circle cx="22" cy="26" r="9" stroke="#D4AF37" stroke-width="1.5"/>
  <circle cx="22" cy="26" r="3" fill="#D4AF37"/>
  <line x1="29" y1="10" x2="22" y2="23" stroke="#D4AF37" stroke-width="1.8" stroke-linecap="round"/>
  <polyline points="27,7 34,7 34,14" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const SVG_HEADSET = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <path d="M10 26C10 15 17 8 24 8C31 8 38 15 38 26" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  <rect x="6" y="24" width="7" height="12" rx="3.5" stroke="#D4AF37" stroke-width="1.5"/>
  <rect x="35" y="24" width="7" height="12" rx="3.5" stroke="#D4AF37" stroke-width="1.5"/>
  <path d="M35 32 Q35 40 28 40" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  <rect x="24" y="38" width="8" height="4" rx="2" stroke="#D4AF37" stroke-width="1.3"/>
</svg>`;

const SVG_ROBOT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <line x1="24" y1="4" x2="24" y2="10" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="24" cy="4" r="1.5" fill="#D4AF37"/>
  <rect x="10" y="10" width="28" height="22" rx="4" stroke="#D4AF37" stroke-width="1.5"/>
  <circle cx="18" cy="20" r="3" stroke="#D4AF37" stroke-width="1.5"/>
  <circle cx="30" cy="20" r="3" stroke="#D4AF37" stroke-width="1.5"/>
  <circle cx="18" cy="20" r="1" fill="#D4AF37"/>
  <circle cx="30" cy="20" r="1" fill="#D4AF37"/>
  <line x1="17" y1="29" x2="31" y2="29" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
  <rect x="6" y="18" width="4" height="8" rx="2" stroke="#D4AF37" stroke-width="1.3"/>
  <rect x="38" y="18" width="4" height="8" rx="2" stroke="#D4AF37" stroke-width="1.3"/>
  <line x1="18" y1="32" x2="16" y2="44" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="30" y1="32" x2="32" y2="44" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const SVG_LAURIER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <path d="M24 42 Q10 36 8 24 Q6 14 14 9" stroke="#D4AF37" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  <path d="M24 42 Q38 36 40 24 Q42 14 34 9" stroke="#D4AF37" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  <ellipse cx="11" cy="12" rx="4.5" ry="2.5" transform="rotate(-45 11 12)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <ellipse cx="9" cy="19" rx="4.5" ry="2.5" transform="rotate(-25 9 19)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <ellipse cx="10" cy="27" rx="4.5" ry="2.5" transform="rotate(-10 10 27)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <ellipse cx="14" cy="34" rx="4.5" ry="2.5" transform="rotate(10 14 34)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <ellipse cx="37" cy="12" rx="4.5" ry="2.5" transform="rotate(45 37 12)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <ellipse cx="39" cy="19" rx="4.5" ry="2.5" transform="rotate(25 39 19)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <ellipse cx="38" cy="27" rx="4.5" ry="2.5" transform="rotate(10 38 27)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <ellipse cx="34" cy="34" rx="4.5" ry="2.5" transform="rotate(-10 34 34)" stroke="#D4AF37" stroke-width="1.2" fill="none"/>
  <path d="M20 43 Q24 45 28 43" stroke="#D4AF37" stroke-width="1.3" fill="none" stroke-linecap="round"/>
</svg>`;

const SVG_LOCK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <rect x="9" y="21" width="30" height="22" rx="3" stroke="#D4AF37" stroke-width="1.5"/>
  <path d="M15 21V17C15 11 33 11 33 17V21" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="24" cy="31" r="3.5" stroke="#D4AF37" stroke-width="1.5"/>
  <line x1="24" y1="34.5" x2="24" y2="38" stroke="#D4AF37" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const SVG_SERVER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <rect x="6" y="7" width="36" height="10" rx="2" stroke="#D4AF37" stroke-width="1.5"/>
  <rect x="6" y="20" width="36" height="10" rx="2" stroke="#D4AF37" stroke-width="1.5"/>
  <rect x="6" y="33" width="36" height="10" rx="2" stroke="#D4AF37" stroke-width="1.5"/>
  <circle cx="37" cy="12" r="2" fill="#D4AF37"/>
  <circle cx="37" cy="25" r="2" fill="#22422A"/>
  <circle cx="37" cy="38" r="2" fill="#D4AF37"/>
  <line x1="10" y1="12" x2="22" y2="12" stroke="#D4AF37" stroke-width="1.3" stroke-linecap="round" opacity="0.45"/>
  <line x1="10" y1="25" x2="22" y2="25" stroke="#D4AF37" stroke-width="1.3" stroke-linecap="round" opacity="0.45"/>
  <line x1="10" y1="38" x2="22" y2="38" stroke="#D4AF37" stroke-width="1.3" stroke-linecap="round" opacity="0.45"/>
</svg>`;

const SVG_CARD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <rect x="4" y="11" width="40" height="26" rx="3.5" stroke="#D4AF37" stroke-width="1.5"/>
  <line x1="4" y1="19" x2="44" y2="19" stroke="#D4AF37" stroke-width="3" opacity="0.25"/>
  <rect x="9" y="25" width="9" height="7" rx="1.5" stroke="#D4AF37" stroke-width="1.3"/>
  <line x1="9" y1="28" x2="18" y2="28" stroke="#D4AF37" stroke-width="0.8" opacity="0.5"/>
  <line x1="12" y1="25" x2="12" y2="32" stroke="#D4AF37" stroke-width="0.8" opacity="0.5"/>
  <line x1="26" y1="28" x2="38" y2="28" stroke="#D4AF37" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/>
  <line x1="26" y1="31" x2="34" y2="31" stroke="#D4AF37" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
</svg>`;

const SVG_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <path d="M24 5L7 12v14c0 10 7.5 16.5 17 19 9.5-2.5 17-9 17-19V12L24 5z" stroke="#D4AF37" stroke-width="1.5" stroke-linejoin="round"/>
  <polyline points="16,25 21,31 32,19" stroke="#22422A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const AGENTS = [
  {
    id: "sybil",
    name: "Sybil",
    title: "Analyste de données",
    tier: "Pro",
    price: 299,
    setupFee: 1500,
    category: "Données & Analytics",
    desc: "Analyse vos bases SQL, génère des rapports automatiques et détecte les anomalies dans vos indicateurs.",
    capabilities: [
      "Requêtes SQL autonomes",
      "Génération de graphiques",
      "Nettoyage de jeux de données CSV",
      "Détection d'anomalies de vente"
    ],
    connectors: ["PostgreSQL/MySQL/SQL Server", "MongoDB", "BigQuery", "Snowflake", "Airtable", "Google Sheets", "Excel Online", "Salesforce API", "HubSpot API", "Stripe API", "Shopify API", "Slack", "Microsoft Teams", "Webhook / API Personnalisée"],
    avatar: SVG_CHART,
    color: "hsl(210, 100%, 60%)", // Blue
    welcome: "Bonjour ! Je suis Sybil, votre analyste de données autonome spécialisée dans l'exploration de données, la génération de rapports et la détection d'anomalies.\n\n **Ce que je peux faire pour vous :**\n- Exécuter des requêtes SQL complexes et analyser vos bases de données en langage naturel.\n- Générer des graphiques interactifs et des rapports d'activité.\n- Nettoyer et analyser vos fichiers CSV de vente.\n\n **Comment je fonctionne :** Connectez-moi à vos bases de données (PostgreSQL, MySQL, Airtable, Snowflake...) ou importez simplement un fichier CSV dans ce chat, puis posez-moi vos questions !",
    stripeLink: ""
  },
  {
    id: "atlas",
    name: "Atlas",
    title: "DevOps & Admin Système",
    tier: "Business",
    price: 599,
    setupFee: 3000,
    category: "Infrastructure",
    desc: "Surveille l'état des serveurs, analyse les logs d'erreurs, déploie des conteneurs Docker et exécute des scripts SSH.",
    capabilities: [
      "Diagnostics système Linux",
      "Déploiement Docker/Kubernetes",
      "Monitoring CPU/RAM en temps réel",
      "Gestion des sauvegardes de bases de données"
    ],
    connectors: ["Serveur SSH", "AWS", "Google Cloud (GCP)", "Microsoft Azure", "GitHub Actions", "GitLab CI/CD", "Docker Hub", "Kubernetes", "Vercel API", "Netlify API", "Heroku API", "Cloudflare API", "Grafana / Prometheus", "Sentry API", "Slack", "Discord", "Webhook Personnalisé"],
    avatar: SVG_SERVER,
    color: "hsl(140, 100%, 45%)", // Green
    welcome: "Atlas à l'écoute, votre administrateur système et ingénieur DevOps autonome.\n\n **Ce que je peux faire pour vous :**\n- Effectuer des diagnostics de vos machines Linux (mémoire, CPU, processus).\n- Gérer vos conteneurs Docker et vos déploiements Kubernetes.\n- Automatiser la surveillance de vos logs et vos sauvegardes de bases de données.\n\n **Comment je fonctionne :** Connectez un serveur via des accès SSH sécurisés ou associez vos plateformes cloud (AWS, GCP, Vercel) dans l'onglet 'Connecteurs', puis donnez-moi vos instructions système en toute simplicité.",
    stripeLink: ""
  },
  {
    id: "chronos",
    name: "Chronos",
    title: "CM & Réseaux Sociaux",
    tier: "Starter",
    price: 149,
    setupFee: 500,
    category: "Marketing",
    desc: "Rédige et planifie vos publications sur LinkedIn, Twitter et Facebook. Analyse l'engagement et répond aux commentaires.",
    capabilities: [
      "Génération d'accroches virales",
      "Planification intelligente de posts",
      "Veille thématique sectorielle",
      "Rapports d'engagement hebdomadaires"
    ],
    connectors: ["LinkedIn API", "X/Twitter API", "Instagram/Facebook API", "TikTok API", "YouTube API", "Pinterest API", "Threads API", "Buffer/Hootsuite", "WhatsApp", "Canva API", "Mailchimp API", "Brevo API", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: SVG_SLIDERS,
    color: "hsl(330, 95%, 60%)", // Pink
    welcome: "Hello ! Je suis Chronos, votre agent marketing autonome spécialisé dans la rédaction et la planification de publications sur les réseaux sociaux (LinkedIn, Twitter, Facebook).\n\n **Ce que je peux faire pour vous :**\n- Rédiger des posts percutants à partir de vos idées brutes ou de notes d'événements.\n- Analyser visuellement vos photos d'événements pour les intégrer intelligemment dans vos posts.\n- Détecter les informations clés et vous suggérer les mentions (@) et hashtags (#) adéquats.\n\n **Fonctionnalité exclusive WhatsApp :**\nVous pouvez me piloter en direct depuis le terrain ! Ajoutez-moi à vos contacts WhatsApp au **+33 7 75 47 54 29** et envoyez-moi vos photos ou messages. Je générerai vos brouillons automatiquement dans votre tableau de bord.\n\n **Comment je fonctionne :** Connectez vos réseaux sociaux et enregistrez votre numéro de téléphone WhatsApp dans l'onglet 'Connecteurs' pour démarrer !",
    stripeLink: ""
  },
  {
    id: "hermes",
    name: "Hermès",
    title: "Rédacteur web & référencement",
    tier: "Pro",
    price: 299,
    setupFee: 1500,
    category: "Contenu & SEO",
    desc: "Rédige, optimise et publie vos contenus web sur WordPress, Webflow ou Notion de façon autonome.",
    capabilities: [
      "Rédaction d'articles SEO de 2000 mots",
      "Recherche sémantique & mots-clés",
      "Optimisation des balises Meta & Alt",
      "Audit de lisibilité & maillage interne"
    ],
    connectors: ["WordPress", "Shopify", "Webflow", "WooCommerce", "PrestaShop", "Medium API", "Notion", "Airtable", "Google Sheets", "Semrush API", "Google Search Console", "Google Analytics", "Jasper API", "Slack", "Webhook Personnalisé"],
    avatar: SVG_ROBOT,
    color: "hsl(45, 100%, 50%)", // Gold
    welcome: "Bonjour ! Je suis Hermes. Prêt à propulser votre site en première page de Google. Quel sujet de blog allons-nous aborder aujourd'hui ?",
    stripeLink: ""
  },
  {
    id: "hestia",
    name: "Hestia",
    title: "Support Client Autonome",
    tier: "Pro",
    price: 299,
    setupFee: 1500,
    category: "Relation Client",
    desc: "Prend en charge votre support client en direct. Résout les tickets courants, recherche dans la FAQ et escalade si nécessaire.",
    capabilities: [
      "Résolution autonome de 80% des tickets",
      "Accès en lecture/écriture à la FAQ",
      "Création automatique de résumés d'incident",
      "Ton professionnel et bienveillant"
    ],
    connectors: ["Zendesk", "Intercom", "Crisp Chat", "Freshdesk", "LiveChat API", "WhatsApp Business API", "Messenger API", "Gmail / Outlook", "Salesforce CRM", "Pipedrive CRM", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: SVG_HEADSET,
    color: "hsl(15, 100%, 55%)", // Orange
    welcome: "Bonjour, ici Hestia. Prête à prendre soin de vos clients. Connectez mon canal de messagerie ou importez votre FAQ de base.",
    stripeLink: ""
  },
  {
    id: "vesta",
    name: "Vesta",
    title: "Prospection & Cold Emailing",
    tier: "Pro",
    price: 299,
    setupFee: 1500,
    category: "Ventes",
    desc: "Identifie les entreprises cibles sur le web, extrait les adresses emails de décideurs et rédige des emails de prospection personnalisés.",
    capabilities: [
      "Scraping de profils d'entreprises",
      "Vérification de la validité d'emails",
      "Rédaction d'emails ultra-personnalisés",
      "Suivi automatique des relances (follow-ups)"
    ],
    connectors: ["Apollo.io API", "LinkedIn Sales Navigator", "Lemlist", "LaGrowthMachine", "HubSpot CRM", "Salesforce CRM", "Pipedrive CRM", "Zoho CRM", "Sellsy CRM", "Phantombuster", "Hunter.io API", "Woodpecker API", "Brevo API", "Gmail/Outlook", "Slack", "Webhook Personnalisé"],
    avatar: SVG_TARGET,
    color: "hsl(270, 90%, 65%)", // Purple
    welcome: "Vesta en place. Prête à remplir votre pipeline commercial. Définissez votre cible (secteur, pays, rôle) pour commencer.",
    stripeLink: ""
  },
  {
    id: "ares",
    name: "Ares",
    title: "Audit Sécurité & Pentest",
    tier: "Business",
    price: 599,
    setupFee: 3000,
    category: "Infrastructure",
    desc: "Recherche en permanence les vulnérabilités de sécurité sur vos serveurs, vos bases de données SQL et vos formulaires web.",
    capabilities: [
      "Scans de ports & vulnérabilités",
      "Vérification de configurations SSL/TLS",
      "Détection d'injections SQL & failles XSS",
      "Rapports de remédiation détaillés"
    ],
    connectors: ["Nmap API", "Serveur SSH", "GitHub Repositories", "GitLab Repositories", "Bitbucket Repositories", "Cloudflare API", "AWS Inspector", "SonarQube API", "Snyk API", "Datadog API", "Slack", "Discord", "Telegram Alerts", "Webhook Personnalisé"],
    avatar: SVG_SHIELD,
    color: "hsl(0, 85%, 60%)", // Red
    welcome: "Ares activé. Prêt à tester la robustesse de votre système. Indiquez-moi l'adresse IP ou le dépôt GitHub à auditer.",
    stripeLink: ""
  },
  {
    id: "athena",
    name: "Athena",
    title: "Product Manager & Jira Wizard",
    tier: "Pro",
    price: 299,
    setupFee: 1500,
    category: "Gestion de Projet",
    desc: "Traduit les besoins métiers en spécifications techniques complètes, rédige les User Stories et gère le backlog Jira.",
    capabilities: [
      "Rédaction de tickets Jira détaillés",
      "Création de cahiers des charges (PRD)",
      "Organisation des priorités de sprint",
      "Génération de comptes-rendus de réunions"
    ],
    connectors: ["Jira Software API", "Confluence", "Notion", "Trello", "Asana", "Monday.com", "Linear API", "Basecamp API", "ClickUp API", "GitHub Projects", "GitLab Issues", "Figma API", "Productboard", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: SVG_ROBOT,
    color: "hsl(180, 80%, 45%)", // Teal
    welcome: "Bonjour, je suis Athena. Structurons ensemble votre prochain produit. Expliquez-moi votre idée de fonctionnalité.",
    stripeLink: ""
  },
  {
    id: "hephaestus",
    name: "Hephaestus",
    title: "Générateur de Code & Refactor",
    tier: "Business",
    price: 599,
    setupFee: 3000,
    category: "Développement",
    desc: "Analyse les dépôts de code, corrige les bugs signalés dans les issues, effectue le refactoring et écrit les tests unitaires.",
    capabilities: [
      "Correction de bugs JavaScript/Python/Go",
      "Écriture de tests unitaires (Jest, Pytest)",
      "Refactoring pour améliorer la lisibilité",
      "Revue de code automatisée en Pull Request"
    ],
    connectors: ["GitHub API", "GitLab API", "Bitbucket API", "Azure DevOps", "SonarQube", "Snyk API", "Jira Software", "Linear API", "AWS CodeCommit", "Slack", "Discord", "Telegram Bot", "Webhook Personnalisé"],
    avatar: SVG_ROBOT,
    color: "hsl(28, 95%, 55%)", // Rusty Orange
    welcome: "Hephaestus prêt au travail. Donnez-moi l'URL du dépôt GitHub ou le fichier de code à analyser et réparer.",
    stripeLink: ""
  },
  {
    id: "iris",
    name: "Iris",
    title: "Veille Concurrentielle",
    tier: "Starter",
    price: 149,
    setupFee: 500,
    category: "Marketing",
    desc: "Surveille quotidiennement les sites de vos concurrents pour détecter les baisses de prix, les nouveaux produits et les offres promotionnelles.",
    capabilities: [
      "Scraping de prix e-commerce",
      "Alertes de nouveaux lancements",
      "Analyse de structure de site concurrent",
      "Synthèse hebdomadaire des mouvements du marché"
    ],
    connectors: ["Scraper API", "Google Sheets", "Airtable", "Shopify API", "WooCommerce API", "Amazon Seller Central", "eBay API", "Google Shopping API", "Notion", "Slack", "Microsoft Teams", "Telegram Alerts", "Webhook Personnalisé"],
    avatar: SVG_TARGET,
    color: "hsl(190, 95%, 50%)", // Light Blue
    welcome: "Iris à votre service. J'ai les yeux ouverts sur vos concurrents. Donnez-moi la liste des sites à surveiller.",
    stripeLink: ""
  },
  {
    id: "apollo",
    name: "Apollo",
    title: "Traducteur & Localisation",
    tier: "Starter",
    price: 149,
    setupFee: 500,
    category: "Contenu & SEO",
    desc: "Traduit et adapte vos articles, interfaces et documents techniques dans 12 langues tout en préservant le ton local.",
    capabilities: [
      "Traduction contextuelle avancée",
      "Localisation d'interfaces logicielles (i18n)",
      "Optimisation SEO multilingue",
      "Traduction de documents PDF et Markdown"
    ],
    connectors: ["Lokalise API", "Crowdin API", "Phrase API", "WordPress", "Shopify", "Webflow", "Notion", "Google Sheets", "Zendesk Guide", "Confluence", "GitHub Repositories", "GitLab Repositories", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: SVG_TARGET,
    color: "hsl(50, 100%, 55%)", // Sun yellow
    welcome: "Welcome ! Je suis Apollo. Prêt à mondialiser votre projet. Soumettez-moi un texte ou connectez votre CMS.",
    stripeLink: ""
  },
  {
    id: "demeter",
    name: "Demeter",
    title: "Automatisation Factures",
    tier: "Pro",
    price: 299,
    setupFee: 1500,
    category: "Finance & Admin",
    desc: "Extrait intelligemment les données clés des factures et reçus (TVA, montant, fournisseur) et les exporte dans vos outils comptables.",
    capabilities: [
      "Lecture OCR intelligente de documents",
      "Calcul et vérification des taux de TVA",
      "Catégorisation automatique des dépenses",
      "Rapprochement bancaire simulé"
    ],
    connectors: ["QuickBooks", "Xero", "Pennylane", "Sellsy Finance", "Axonaut", "Qonto API", "Spendesk API", "Stripe API", "PayPal API", "Lydia Pro", "Google Drive", "Dropbox", "Microsoft OneDrive", "Slack", "Email Inboxes", "Webhook Personnalisé"],
    avatar: SVG_CARD,
    color: "hsl(110, 80%, 50%)", // Light Green
    welcome: "Bonjour, je suis Demeter. Envoyez-moi vos factures ou connectez votre boîte de réception pour les traiter automatiquement.",
    stripeLink: ""
  },
  {
    id: "janus",
    name: "Janus",
    title: "Gestionnaire de Wiki & Connaissances",
    tier: "Pro",
    price: 299,
    setupFee: 1500,
    category: "Gestion de Projet",
    desc: "Centralise la documentation interne de votre entreprise, répond instantanément aux questions des employés sur la base du wiki.",
    capabilities: [
      "Indexation intelligente de documents PDF/Word",
      "Réponses aux questions avec citations",
      "Détection des articles obsolètes",
      "Suggestions d'amélioration de la documentation"
    ],
    connectors: ["Confluence", "Notion", "Google Drive", "Microsoft OneDrive", "SharePoint", "Dropbox", "Box API", "GitBook", "Zendesk Guide", "Intercom Articles", "Evernote API", "Slack Bot", "Microsoft Teams Bot", "Webhook Personnalisé"],
    avatar: SVG_LOCK,
    color: "hsl(200, 85%, 60%)", // Sky Blue
    welcome: "Bonjour ! Je suis Janus. J'organise et protège vos connaissances internes. Connectez un Google Drive ou Notion pour commencer.",
    stripeLink: ""
  },
  {
    id: "nemesis",
    name: "Nemesis",
    title: "Modérateur de Contenu",
    tier: "Starter",
    price: 149,
    setupFee: 500,
    category: "Relation Client",
    desc: "Analyse en temps réel les commentaires, messages de forums ou avis sur vos sites pour filtrer le spam, les insultes et le contenu inapproprié.",
    capabilities: [
      "Détection de discours haineux & harcèlement",
      "Filtrage du spam et liens suspects",
      "Floutage automatique d'images sensibles",
      "Statistiques de modération hebdomadaires"
    ],
    connectors: ["Webhooks API", "WordPress Comments", "Disqus API", "Facebook Comments API", "Instagram Comments API", "YouTube Comments API", "TikTok Comments API", "Reddit API", "Twitch Chat API", "Crisp Chat", "Discord Bot", "Telegram Bot", "Slack", "Webhook Personnalisé"],
    avatar: SVG_SHIELD,
    color: "hsl(280, 80%, 45%)", // Deep Purple
    welcome: "Nemesis activée. Prête à sécuriser vos espaces d'échanges. Configurez un webhook pour me soumettre vos flux de commentaires.",
    stripeLink: ""
  },
  {
    id: "zeus",
    name: "Zeus",
    title: "Superviseur de flotte",
    tier: "Enterprise",
    price: 0,
    setupFee: 0,
    category: "Gestion de Projet",
    desc: "Orchestre plusieurs agents simultanément et s'intègre sur mesure à vos systèmes d'information internes.",
    capabilities: [
      "Décomposition de tâches complexes",
      "Distribution des rôles aux sous-agents",
      "Contrôle qualité des livrables intermédiaires",
      "Rapport final unifié pour le client"
    ],
    connectors: ["Tous les connecteurs d'agents", "Notion API", "Airtable API", "Jira API", "ClickUp API", "Linear API", "Asana API", "Monday.com API", "HubSpot CRM", "Slack", "Microsoft Teams", "Email Alerts", "Webhook Personnalisé"],
    avatar: SVG_LAURIER,
    color: "hsl(340, 100%, 50%)", // Crimson
    welcome: "Je suis Zeus, superviseur de vos équipes d'agents. Indiquez-moi le projet global à réaliser et je mobiliserai les agents nécessaires.",
    stripeLink: ""
  }
];
