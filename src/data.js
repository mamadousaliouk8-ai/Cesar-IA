export const AGENTS = [
  {
    id: "sybil",
    name: "Sybil",
    title: "Analyste de Données & BI",
    price: 49,
    category: "Données & Analytics",
    desc: "Prédit les tendances de ventes, analyse les KPI métiers et génère des rapports SQL ou graphiques interactifs.",
    capabilities: [
      "Requêtes SQL autonomes",
      "Génération de graphiques",
      "Nettoyage de jeux de données CSV",
      "Détection d'anomalies de vente"
    ],
    connectors: ["PostgreSQL/MySQL/SQL Server", "MongoDB", "BigQuery", "Snowflake", "Airtable", "Google Sheets", "Excel Online", "Salesforce API", "HubSpot API", "Stripe API", "Shopify API", "Slack", "Microsoft Teams", "Webhook / API Personnalisée"],
    avatar: "📊",
    color: "hsl(210, 100%, 60%)", // Blue
    welcome: "Bonjour ! Je suis Sybil. Prête à faire parler vos données. Connectez-moi à votre base SQL ou importez un CSV pour commencer l'analyse.",
    stripeLink: ""
  },
  {
    id: "atlas",
    name: "Atlas",
    title: "DevOps & Admin Système",
    price: 79,
    category: "Infrastructure",
    desc: "Surveille l'état des serveurs, analyse les logs d'erreurs, déploie des conteneurs Docker et exécute des scripts SSH.",
    capabilities: [
      "Diagnostics système Linux",
      "Déploiement Docker/Kubernetes",
      "Monitoring CPU/RAM en temps réel",
      "Gestion des sauvegardes de bases de données"
    ],
    connectors: ["Serveur SSH", "AWS", "Google Cloud (GCP)", "Microsoft Azure", "GitHub Actions", "GitLab CI/CD", "Docker Hub", "Kubernetes", "Vercel API", "Netlify API", "Heroku API", "Cloudflare API", "Grafana / Prometheus", "Sentry API", "Slack", "Discord", "Webhook Personnalisé"],
    avatar: "⚡",
    color: "hsl(140, 100%, 45%)", // Green
    welcome: "Atlas à l'écoute. Prêt à administrer vos serveurs. Connectez une machine via SSH ou configurez un webhook GitHub.",
    stripeLink: ""
  },
  {
    id: "chronos",
    name: "Chronos",
    title: "CM & Réseaux Sociaux",
    price: 29,
    category: "Marketing",
    desc: "Rédige et planifie vos publications sur LinkedIn, Twitter et Facebook. Analyse l'engagement et répond aux commentaires.",
    capabilities: [
      "Génération d'accroches virales",
      "Planification intelligente de posts",
      "Veille thématique sectorielle",
      "Rapports d'engagement hebdomadaires"
    ],
    connectors: ["LinkedIn API", "X/Twitter API", "Instagram/Facebook API", "TikTok API", "YouTube API", "Pinterest API", "Threads API", "Buffer/Hootsuite", "WhatsApp Business API", "Canva API", "Mailchimp API", "Brevo API", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: "🕒",
    color: "hsl(330, 95%, 60%)", // Pink
    welcome: "Hello ! Je suis Chronos. Je m'occupe d'amplifier votre présence sur les réseaux sociaux. Connectez vos comptes pour démarrer.",
    stripeLink: ""
  },
  {
    id: "hermes",
    name: "Hermes",
    title: "Rédacteur Web & SEO",
    price: 39,
    category: "Contenu & SEO",
    desc: "Rédige des articles optimisés pour les moteurs de recherche, recherche des mots-clés stratégiques et analyse la concurrence.",
    capabilities: [
      "Rédaction d'articles SEO de 2000 mots",
      "Recherche sémantique & mots-clés",
      "Optimisation des balises Meta & Alt",
      "Audit de lisibilité & maillage interne"
    ],
    connectors: ["WordPress", "Shopify", "Webflow", "WooCommerce", "PrestaShop", "Medium API", "Notion", "Airtable", "Google Sheets", "Semrush API", "Google Search Console", "Google Analytics", "Jasper API", "Slack", "Webhook Personnalisé"],
    avatar: "✍️",
    color: "hsl(45, 100%, 50%)", // Gold
    welcome: "Bonjour ! Je suis Hermes. Prêt à propulser votre site en première page de Google. Quel sujet de blog allons-nous aborder aujourd'hui ?",
    stripeLink: ""
  },
  {
    id: "hestia",
    name: "Hestia",
    title: "Support Client Autonome",
    price: 59,
    category: "Relation Client",
    desc: "Prend en charge votre support client en direct. Résout les tickets courants, recherche dans la FAQ et escalade si nécessaire.",
    capabilities: [
      "Résolution autonome de 80% des tickets",
      "Accès en lecture/écriture à la FAQ",
      "Création automatique de résumés d'incident",
      "Ton professionnel et bienveillant"
    ],
    connectors: ["Zendesk", "Intercom", "Crisp Chat", "Freshdesk", "LiveChat API", "WhatsApp Business API", "Messenger API", "Gmail / Outlook", "Salesforce CRM", "Pipedrive CRM", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: "🔥",
    color: "hsl(15, 100%, 55%)", // Orange
    welcome: "Bonjour, ici Hestia. Prête à prendre soin de vos clients. Connectez mon canal de messagerie ou importez votre FAQ de base.",
    stripeLink: ""
  },
  {
    id: "vesta",
    name: "Vesta",
    title: "Prospection & Cold Emailing",
    price: 49,
    category: "Ventes",
    desc: "Identifie les entreprises cibles sur le web, extrait les adresses emails de décideurs et rédige des emails de prospection personnalisés.",
    capabilities: [
      "Scraping de profils d'entreprises",
      "Vérification de la validité d'emails",
      "Rédaction d'emails ultra-personnalisés",
      "Suivi automatique des relances (follow-ups)"
    ],
    connectors: ["Apollo.io API", "LinkedIn Sales Navigator", "Lemlist", "LaGrowthMachine", "HubSpot CRM", "Salesforce CRM", "Pipedrive CRM", "Zoho CRM", "Sellsy CRM", "Phantombuster", "Hunter.io API", "Woodpecker API", "Brevo API", "Gmail/Outlook", "Slack", "Webhook Personnalisé"],
    avatar: "🎯",
    color: "hsl(270, 90%, 65%)", // Purple
    welcome: "Vesta en place. Prête à remplir votre pipeline commercial. Définissez votre cible (secteur, pays, rôle) pour commencer.",
    stripeLink: ""
  },
  {
    id: "ares",
    name: "Ares",
    title: "Audit Sécurité & Pentest",
    price: 99,
    category: "Infrastructure",
    desc: "Recherche en permanence les vulnérabilités de sécurité sur vos serveurs, vos bases de données SQL et vos formulaires web.",
    capabilities: [
      "Scans de ports & vulnérabilités",
      "Vérification de configurations SSL/TLS",
      "Détection d'injections SQL & failles XSS",
      "Rapports de remédiation détaillés"
    ],
    connectors: ["Nmap API", "Serveur SSH", "GitHub Repositories", "GitLab Repositories", "Bitbucket Repositories", "Cloudflare API", "AWS Inspector", "SonarQube API", "Snyk API", "Datadog API", "Slack", "Discord", "Telegram Alerts", "Webhook Personnalisé"],
    avatar: "🛡️",
    color: "hsl(0, 85%, 60%)", // Red
    welcome: "Ares activé. Prêt à tester la robustesse de votre système. Indiquez-moi l'adresse IP ou le dépôt GitHub à auditer.",
    stripeLink: ""
  },
  {
    id: "athena",
    name: "Athena",
    title: "Product Manager & Jira Wizard",
    price: 39,
    category: "Gestion de Projet",
    desc: "Traduit les besoins métiers en spécifications techniques complètes, rédige les User Stories et gère le backlog Jira.",
    capabilities: [
      "Rédaction de tickets Jira détaillés",
      "Création de cahiers des charges (PRD)",
      "Organisation des priorités de sprint",
      "Génération de comptes-rendus de réunions"
    ],
    connectors: ["Jira Software API", "Confluence", "Notion", "Trello", "Asana", "Monday.com", "Linear API", "Basecamp API", "ClickUp API", "GitHub Projects", "GitLab Issues", "Figma API", "Productboard", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: "🏛️",
    color: "hsl(180, 80%, 45%)", // Teal
    welcome: "Bonjour, je suis Athena. Structurons ensemble votre prochain produit. Expliquez-moi votre idée de fonctionnalité.",
    stripeLink: ""
  },
  {
    id: "hephaestus",
    name: "Hephaestus",
    title: "Générateur de Code & Refactor",
    price: 69,
    category: "Développement",
    desc: "Analyse les dépôts de code, corrige les bugs signalés dans les issues, effectue le refactoring et écrit les tests unitaires.",
    capabilities: [
      "Correction de bugs JavaScript/Python/Go",
      "Écriture de tests unitaires (Jest, Pytest)",
      "Refactoring pour améliorer la lisibilité",
      "Revue de code automatisée en Pull Request"
    ],
    connectors: ["GitHub API", "GitLab API", "Bitbucket API", "Azure DevOps", "SonarQube", "Snyk API", "Jira Software", "Linear API", "AWS CodeCommit", "Slack", "Discord", "Telegram Bot", "Webhook Personnalisé"],
    avatar: "🔨",
    color: "hsl(28, 95%, 55%)", // Rusty Orange
    welcome: "Hephaestus prêt au travail. Donnez-moi l'URL du dépôt GitHub ou le fichier de code à analyser et réparer.",
    stripeLink: ""
  },
  {
    id: "iris",
    name: "Iris",
    title: "Veille Concurrentielle",
    price: 39,
    category: "Marketing",
    desc: "Surveille quotidiennement les sites de vos concurrents pour détecter les baisses de prix, les nouveaux produits et les offres promotionnelles.",
    capabilities: [
      "Scraping de prix e-commerce",
      "Alertes de nouveaux lancements",
      "Analyse de structure de site concurrent",
      "Synthèse hebdomadaire des mouvements du marché"
    ],
    connectors: ["Scraper API", "Google Sheets", "Airtable", "Shopify API", "WooCommerce API", "Amazon Seller Central", "eBay API", "Google Shopping API", "Notion", "Slack", "Microsoft Teams", "Telegram Alerts", "Webhook Personnalisé"],
    avatar: "👁️",
    color: "hsl(190, 95%, 50%)", // Light Blue
    welcome: "Iris à votre service. J'ai les yeux ouverts sur vos concurrents. Donnez-moi la liste des sites à surveiller.",
    stripeLink: ""
  },
  {
    id: "apollo",
    name: "Apollo",
    title: "Traducteur & Localisation",
    price: 29,
    category: "Contenu & SEO",
    desc: "Traduit et adapte vos articles, interfaces et documents techniques dans 12 langues tout en préservant le ton local.",
    capabilities: [
      "Traduction contextuelle avancée",
      "Localisation d'interfaces logicielles (i18n)",
      "Optimisation SEO multilingue",
      "Traduction de documents PDF et Markdown"
    ],
    connectors: ["Lokalise API", "Crowdin API", "Phrase API", "WordPress", "Shopify", "Webflow", "Notion", "Google Sheets", "Zendesk Guide", "Confluence", "GitHub Repositories", "GitLab Repositories", "Slack", "Microsoft Teams", "Webhook Personnalisé"],
    avatar: "☀️",
    color: "hsl(50, 100%, 55%)", // Sun yellow
    welcome: "Welcome ! Je suis Apollo. Prêt à mondialiser votre projet. Soumettez-moi un texte ou connectez votre CMS.",
    stripeLink: ""
  },
  {
    id: "demeter",
    name: "Demeter",
    title: "Automatisation Factures",
    price: 49,
    category: "Finance & Admin",
    desc: "Extrait intelligemment les données clés des factures et reçus (TVA, montant, fournisseur) et les exporte dans vos outils comptables.",
    capabilities: [
      "Lecture OCR intelligente de documents",
      "Calcul et vérification des taux de TVA",
      "Catégorisation automatique des dépenses",
      "Rapprochement bancaire simulé"
    ],
    connectors: ["QuickBooks", "Xero", "Pennylane", "Sellsy Finance", "Axonaut", "Qonto API", "Spendesk API", "Stripe API", "PayPal API", "Lydia Pro", "Google Drive", "Dropbox", "Microsoft OneDrive", "Slack", "Email Inboxes", "Webhook Personnalisé"],
    avatar: "🌾",
    color: "hsl(110, 80%, 50%)", // Light Green
    welcome: "Bonjour, je suis Demeter. Envoyez-moi vos factures ou connectez votre boîte de réception pour les traiter automatiquement.",
    stripeLink: ""
  },
  {
    id: "janus",
    name: "Janus",
    title: "Gestionnaire de Wiki & Connaissances",
    price: 39,
    category: "Gestion de Projet",
    desc: "Centralise la documentation interne de votre entreprise, répond instantanément aux questions des employés sur la base du wiki.",
    capabilities: [
      "Indexation intelligente de documents PDF/Word",
      "Réponses aux questions avec citations",
      "Détection des articles obsolètes",
      "Suggestions d'amélioration de la documentation"
    ],
    connectors: ["Confluence", "Notion", "Google Drive", "Microsoft OneDrive", "SharePoint", "Dropbox", "Box API", "GitBook", "Zendesk Guide", "Intercom Articles", "Evernote API", "Slack Bot", "Microsoft Teams Bot", "Webhook Personnalisé"],
    avatar: "🗝️",
    color: "hsl(200, 85%, 60%)", // Sky Blue
    welcome: "Bonjour ! Je suis Janus. J'organise et protège vos connaissances internes. Connectez un Google Drive ou Notion pour commencer.",
    stripeLink: ""
  },
  {
    id: "nemesis",
    name: "Nemesis",
    title: "Modérateur de Contenu",
    price: 29,
    category: "Relation Client",
    desc: "Analyse en temps réel les commentaires, messages de forums ou avis sur vos sites pour filtrer le spam, les insultes et le contenu inapproprié.",
    capabilities: [
      "Détection de discours haineux & harcèlement",
      "Filtrage du spam et liens suspects",
      "Floutage automatique d'images sensibles",
      "Statistiques de modération hebdomadaires"
    ],
    connectors: ["Webhooks API", "WordPress Comments", "Disqus API", "Facebook Comments API", "Instagram Comments API", "YouTube Comments API", "TikTok Comments API", "Reddit API", "Twitch Chat API", "Crisp Chat", "Discord Bot", "Telegram Bot", "Slack", "Webhook Personnalisé"],
    avatar: "⚖️",
    color: "hsl(280, 80%, 45%)", // Deep Purple
    welcome: "Nemesis activée. Prête à sécuriser vos espaces d'échanges. Configurez un webhook pour me soumettre vos flux de commentaires.",
    stripeLink: ""
  },
  {
    id: "zeus",
    name: "Zeus",
    title: "Superviseur d'Agents (Manager)",
    price: 129,
    category: "Gestion de Projet",
    desc: "Le chef d'orchestre ultime. Coordonne plusieurs autres agents IA pour résoudre des projets multi-étapes très complexes.",
    capabilities: [
      "Décomposition de tâches complexes",
      "Distribution des rôles aux sous-agents",
      "Contrôle qualité des livrables intermédiaires",
      "Rapport final unifié pour le client"
    ],
    connectors: ["Tous les connecteurs d'agents", "Notion API", "Airtable API", "Jira API", "ClickUp API", "Linear API", "Asana API", "Monday.com API", "HubSpot CRM", "Slack", "Microsoft Teams", "Email Alerts", "Webhook Personnalisé"],
    avatar: "👑",
    color: "hsl(340, 100%, 50%)", // Crimson
    welcome: "Je suis Zeus, superviseur de vos équipes d'agents. Indiquez-moi le projet global à réaliser et je mobiliserai les agents nécessaires.",
    stripeLink: ""
  }
];
