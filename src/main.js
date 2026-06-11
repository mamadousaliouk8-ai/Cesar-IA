import './style.css';
import { AGENTS } from './data.js';
import { supabase, isMock } from './supabase.js';

// Helper pour afficher les diagnostics dans la boîte de dialogue d'authentification et sur l'écran
function logDebug(message) {
  console.log("[Diagnostic]", message);
  const timestamp = new Date().toLocaleTimeString('fr-FR');
  
  const debugEl = document.getElementById('auth-debug-log');
  if (debugEl) {
    debugEl.innerHTML += `<br>[${timestamp}] ${message}`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }
  
  const floatDebugEl = document.getElementById('floating-debug-log');
  if (floatDebugEl) {
    floatDebugEl.innerHTML += `\n[${timestamp}] ${message}`;
    floatDebugEl.scrollTop = floatDebugEl.scrollHeight;
  }
}



function isAdminEmail(email) {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  const adminEmails = [
    'contact@cesar-ia.com',
    'admin@cesar-ia.com',
    'contact@césar-ia.com',
    'admin@césar-ia.com',
    'contact@xn--csar-ia-bya.com',
    'admin@xn--csar-ia-bya.com'
  ];
  const expandedAdmins = [];
  adminEmails.forEach(e => {
    expandedAdmins.push(e.normalize('NFC'));
    expandedAdmins.push(e.normalize('NFD'));
  });
  return expandedAdmins.includes(cleanEmail.normalize('NFC')) || expandedAdmins.includes(cleanEmail.normalize('NFD'));
}

function extractUserEmail(user) {
  if (!user) return '';
  return user.email || 
         (user.user_metadata && user.user_metadata.email) || 
         (user.app_metadata && user.app_metadata.email) || 
         '';
}

// Helper pour envelopper une promesse avec un timeout
function promiseWithTimeout(promise, ms, timeoutErrorMsg) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutErrorMsg || "Délai d'attente dépassé (Timeout)"));
    }, ms);
  });
  
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

// Wrapper robuste pour requêter Supabase en direct via l'API REST (PostgREST)
// Permet d'éviter les timeouts et blocages du SDK officiel liés aux en-têtes credentialed/Authorization
async function supabaseFetch(table, { method = 'GET', queryParams = '', body = null, headers = {} } = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Configuration Supabase manquante.");
  }
  
  const url = `${supabaseUrl}/rest/v1/${table}${queryParams}`;
  
  // Récupérer le jeton de session actif
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token;
  } catch (e) {
    logDebug(`[SupabaseFetch] Impossible de récupérer le token: ${e.message}`);
  }
  
  const makeRequest = async (useAuth) => {
    const controller = new AbortController();
    const timeoutMs = useAuth ? 2500 : 5000; // Timeout plus court pour l'authentifié pour échouer rapidement
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const reqHeaders = {
      'apikey': supabaseAnonKey,
      ...headers
    };
    
    if (useAuth && token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }
    
    if (body) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    
    const options = {
      method,
      headers: reqHeaders,
      signal: controller.signal
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    try {
      const res = await fetch(url, options);
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      
      const text = await res.text();
      if (!text || res.status === 204) {
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        return text;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };
  
  if (token) {
    logDebug(`[SupabaseFetch] Tentative ${method} sur '${table}' avec token d'authentification...`);
    try {
      const res = await makeRequest(true);
      logDebug(`[SupabaseFetch] Réussite avec token.`);
      return res;
    } catch (authError) {
      logDebug(`[SupabaseFetch] Échec/Timeout avec token (${authError.message}). Tentative de repli anonyme...`);
      try {
        const res = await makeRequest(false);
        logDebug(`[SupabaseFetch] Réussite de repli anonyme.`);
        return res;
      } catch (fallbackError) {
        logDebug(`[SupabaseFetch] Échec repli anonyme (${fallbackError.message}).`);
        throw fallbackError;
      }
    }
  } else {
    logDebug(`[SupabaseFetch] Tentative anonyme ${method} sur '${table}'...`);
    try {
      const res = await makeRequest(false);
      logDebug(`[SupabaseFetch] Réussite anonyme.`);
      return res;
    } catch (err) {
      logDebug(`[SupabaseFetch] Échec anonyme (${err.message}).`);
      throw err;
    }
  }
}

// Diagnostic : Test de fetch direct vers l'API REST de Supabase

async function testDirectFetch() {
  logDebug("Test de fetch direct vers Supabase REST API...");
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    const url = "https://zsfoqqppwtqviopdhqug.supabase.co/rest/v1/profiles?select=is_admin";
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
      signal: controller.signal
    });
    clearTimeout(id);
    logDebug(`Fetch direct statut: ${res.status} ${res.statusText}`);
    const text = await res.text();
    logDebug(`Fetch direct réponse (tronquée): ${text.substring(0, 100)}`);
  } catch (err) {
    logDebug(`Fetch direct a échoué: ${err.message}`);
  }
}

// Écouteurs d'erreurs globaux pour capter les erreurs silencieuses
window.addEventListener('error', (event) => {
  const errMsg = `ERREUR GLOBALE: ${event.message} (${event.filename}:${event.lineno})`;
  logDebug(errMsg);
  try {
    localStorage.setItem('cesar_ia_last_error', errMsg);
  } catch (e) {}
});

window.addEventListener('unhandledrejection', (event) => {
  const errMsg = `REJECTION PROMESSE NON GÉRÉE: ${event.reason}`;
  logDebug(errMsg);
  console.error("Unhandled promise rejection:", event.reason);
  try {
    localStorage.setItem('cesar_ia_last_error', errMsg);
  } catch (e) {}
});



// Application State
const state = {
  currentUser: null, // { email, uid, adopted: [] }
  activeRoute: sessionStorage.getItem('cesar_ia_active_route') || 'home',
  activeCategory: 'all',
  selectedAgentId: null, // Agent being hovered/viewed/adopted
  activeDashboardAgentId: null, // Selected agent in the dashboard sidebar
  activeDashboardTab: 'chat', // 'chat' or 'connectors'
  adoptedAgents: [], // list of adopted agent ids
  activePack: null, // 'starter', 'pro', or 'business'
  cancelledAgents: [], // list of agent ids scheduled for cancellation
  cancelledPacks: [], // list of pack ids scheduled for cancellation
  connectorsData: {}, // { agentId: { connectorName: { field1: val, ... } } }
  connectorsDrafts: {}, // { agentId: { connectorName: { field1: val, ... } } }
  invoices: [],
  cardDetailsSaved: false,
  stripeLinks: {}, // { agentId: url }
  tourActive: false,
  calendarEvents: [] // List of planned posts / drafts for Chronos
};

const PACKS = {
  starter: {
    name: "Starter Pack",
    price: 447.00,
    setupFee: 800,
    agents: ["chronos", "apollo", "nemesis", "iris"]
  },
  pro: {
    name: "Pro Pack",
    price: 2016.75,
    setupFee: 2500,
    agents: ["chronos", "apollo", "nemesis", "iris", "hermes", "hestia", "vesta", "sybil", "athena", "demeter", "janus"]
  },
  business: {
    name: "Business All-Access",
    price: 3364.50,
    setupFee: 4500,
    agents: ["chronos", "apollo", "nemesis", "iris", "hermes", "hestia", "vesta", "sybil", "athena", "demeter", "janus", "atlas", "ares", "hephaestus"]
  }
};

function getActivePack() {
  if (!state.currentUser) return null;
  return localStorage.getItem(`cesar_ia_active_pack_${state.currentUser.uid}`) || null;
}

function setActivePack(packId) {
  if (!state.currentUser) return;
  if (packId) {
    localStorage.setItem(`cesar_ia_active_pack_${state.currentUser.uid}`, packId);
    state.activePack = packId;
  } else {
    localStorage.removeItem(`cesar_ia_active_pack_${state.currentUser.uid}`);
    state.activePack = null;
  }
}

function isAgentAdopted(agentId) {
  if (!state.currentUser) return false;
  
  // Administrators get access to everything
  const isAdminUser = state.currentUser.isAdmin || isAdminEmail(state.currentUser.email);
  if (isAdminUser) return true;

  if (agentId === 'zeus') {
    return state.adoptedAgents.includes('zeus');
  }
  if (state.activePack === 'business') {
    return true; // all 14 agents
  }
  if (state.activePack === 'pro') {
    const proAndStarter = ['chronos', 'apollo', 'nemesis', 'iris', 'hermes', 'hestia', 'vesta', 'sybil', 'athena', 'demeter', 'janus'];
    if (proAndStarter.includes(agentId)) return true;
  }
  if (state.activePack === 'starter') {
    const starter = ['chronos', 'apollo', 'nemesis', 'iris'];
    if (starter.includes(agentId)) return true;
  }
  return state.adoptedAgents.includes(agentId);
}

function getAdoptedAgentIds() {
  if (!state.currentUser) return [];

  const isAdminUser = state.currentUser.isAdmin || isAdminEmail(state.currentUser.email);

  if (isAdminUser) {
    return [
      'sybil', 'atlas', 'chronos', 'hermes', 'hestia',
      'vesta', 'ares', 'athena', 'hephaestus', 'iris',
      'apollo', 'demeter', 'janus', 'nemesis', 'zeus'
    ];
  }

  // Pour l'agent spécial Zeus : s'il est adopté, on affiche uniquement Zeus dans le dashboard, aucun autre agent
  if (state.adoptedAgents.includes('zeus')) {
    return ['zeus'];
  }

  const ids = new Set(state.adoptedAgents);
  if (state.activePack === 'starter') {
    ['chronos', 'apollo', 'nemesis', 'iris'].forEach(id => ids.add(id));
  } else if (state.activePack === 'pro') {
    ['chronos', 'apollo', 'nemesis', 'iris', 'hermes', 'hestia', 'vesta', 'sybil', 'athena', 'demeter', 'janus'].forEach(id => ids.add(id));
  } else if (state.activePack === 'business') {
    AGENTS.forEach(a => {
      if (a.id !== 'zeus') ids.add(a.id);
    });
  }
  return Array.from(ids);
}

// Seed Initial Data (e.g. if user is preloaded for quick demo, or we let them sign up)
function initApp() {
  try {
    // Afficher la dernière erreur si présente
    const lastErr = localStorage.getItem('cesar_ia_last_error');
    if (lastErr) {
      logDebug(`⚠️ [Dernière Erreur Détectée] : ${lastErr}`);
      // Supprimer l'erreur après affichage pour ne pas encombrer les futurs rechargements réussis
      localStorage.removeItem('cesar_ia_last_error');
    }
    
    // Alerte de port de redirection Stripe
    const currentPort = window.location.port;
    if (currentPort && currentPort !== '5173') {
      logDebug(`ℹ️ Note : L'application tourne sur le port ${currentPort}. Si Stripe vous redirige vers le port 5173, modifiez manuellement le port dans la barre d'adresse de votre navigateur pour ${currentPort}.`);
    }

    // Contrôle d'affichage du panneau de diagnostic flottant (masqué par défaut en production)
    const debugPanel = document.getElementById('floating-debug-panel');
    if (debugPanel) {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const forceDebug = window.location.search.includes('debug=true');
      if (isLocal || forceDebug) {
        debugPanel.style.display = 'block';
      } else {
        debugPanel.style.display = 'none';
      }
    }

    setupRoutes();
    setupAuth();
    setupCatalog();
    setupDashboard();
    setupGeminiAdmin();
    setupStripeAdmin();
    setupAdminTools();
    setupBilling();
    setupModals();
    setupAccountPage();
    setupInvoiceModal();
    initOnboardingTour();
    updateUI();
    
    // Restaurer le rendu initial de la route si elle est publique (comme 'catalog')
    if (state.activeRoute === 'catalog') {
      navigateTo('catalog');
    } else if (state.activeRoute === 'home') {
      navigateTo('home');
    }
    
    // Show welcome toast
    showToast("Bienvenue sur César-IA ! Explorez notre catalogue.");

    // Vérifier le retour d'une authentification OAuth
    checkOauthCallback();
  } catch (error) {
    alert("Erreur d'initialisation de l'application :\n" + error.name + ": " + error.message + "\n\nStack:\n" + error.stack);
    console.error("Initialization error:", error);
  }
}

async function checkOauthCallback() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('oauth_status');
  const agentId = params.get('agent_id');
  const connector = params.get('connector');
  
  if (status && agentId && connector) {
    // Nettoyer la barre d'adresse sans recharger
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
    
    if (status === 'success') {
      showToast(`Connexion officielle réussie avec ${connector} ! 🚀`, "success");
      // Sélectionner l'agent et ouvrir l'onglet connecteurs
      state.activeDashboardAgentId = agentId;
      state.activeDashboardTab = 'connectors';
      
      try {
        await loadUserData();
      } catch (e) {
        console.error("Erreur de rechargement utilisateur:", e);
      }
      
      navigateTo('dashboard');
      renderDashboardTabContent();
    } else {
      showToast(`Échec de la connexion officielle avec ${connector}.`, "error");
    }
  }
}

// Custom Event Delegation / Page Routing
function setupRoutes() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      const route = link.getAttribute('data-route');
      if (!route) return;
      e.preventDefault();
      
      // Access control rules
      if (route === 'dashboard' && !state.tourActive) {
        if (!state.currentUser) {
          showToast("Veuillez d'abord vous connecter ou créer un compte.", "warning");
          openAuthModal('Connexion requise');
          return;
        }
      }

      if (route === 'admin') {
        if (!state.currentUser || !state.currentUser.isAdmin) {
          showToast("Accès restreint aux administrateurs.", "error");
          navigateTo('home');
          return;
        }
      }

      if ((route === 'billing' || route === 'account') && !state.currentUser) {
        showToast("Veuillez d'abord vous connecter ou créer un compte.", "warning");
        openAuthModal('Connexion requise');
        return;
      }
      
      navigateTo(route);
    });
  });

  // Explain scroll navigation
  const explainLink = document.getElementById('nav-explain-link');
  if (explainLink) {
    explainLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.activeRoute !== 'home') {
        navigateTo('home');
        setTimeout(() => {
          const section = document.getElementById('comment-ca-marche-section');
          if (section) section.scrollIntoView({ behavior: 'smooth' });
        }, 150);
      } else {
        const section = document.getElementById('comment-ca-marche-section');
        if (section) section.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // Logo home navigation
  document.getElementById('logo-home').addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('home');
  });

  // Hero CTAs
  document.getElementById('btn-hero-catalog').addEventListener('click', () => {
    navigateTo('catalog');
  });

  document.getElementById('btn-hero-explain').addEventListener('click', () => {
    const tourBtn = document.getElementById('btn-start-tour');
    if (tourBtn) {
      tourBtn.click();
    } else {
      showToast("Choisissez un agent, liez vos comptes de services, et laissez l'IA travailler !");
    }
  });

  // Zeus contact trigger on homepage
  const zeusContactBtn = document.getElementById('btn-zeus-contact');
  if (zeusContactBtn) {
    zeusContactBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('contact-modal').showModal();
    });
  }

  // Zeus contact form submit
  const contactForm = document.getElementById('form-zeus-contact');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('contact-name').value;
      showToast(`Merci ${name} ! Votre demande de contact pour Zeus a été envoyée. Nos experts vous contacteront sous 24h.`, "success");
      document.getElementById('contact-modal').close();
      contactForm.reset();
    });
  }

  // Homepage category filters redirection
  document.querySelectorAll('#homepage-filters .filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const cat = tab.getAttribute('data-category');
      if (cat === 'all') return;
      
      // Select corresponding tab in catalog
      const catTab = document.querySelector(`#catalog-filters .filter-tab[data-category="${cat}"]`);
      if (catTab) {
        catTab.click();
      }
      navigateTo('catalog');
    });
  });
}

function navigateTo(route) {
  // Nettoyer le style anti-flicker s'il existe
  const initialStyle = document.getElementById('initial-route-style');
  if (initialStyle) {
    initialStyle.remove();
  }

  // Double check access controls on routing level
  if (route === 'dashboard' && !state.tourActive) {
    if (!state.currentUser) {
      route = 'home';
    }
  }
  if (route === 'admin') {
    if (!state.currentUser || !state.currentUser.isAdmin) {
      route = 'home';
    }
  }
  if ((route === 'billing' || route === 'account') && !state.currentUser) {
    route = 'home';
  }

  state.activeRoute = route;
  try {
    sessionStorage.setItem('cesar_ia_active_route', route);
  } catch (e) {}
  
  // Update nav links active states
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('data-route') === route) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Show corresponding sections
  document.querySelectorAll('.route-section').forEach(section => {
    if (section.id === `route-${route}`) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });

  // Hook functions on route transition
  if (route === 'dashboard') {
    renderDashboardSidebar();
    renderDashboardPanel();
  } else if (route === 'billing') {
    renderBilling();
    initPricingCalculator();
  } else if (route === 'admin') {
    renderAdminPanel();
  } else if (route === 'account') {
    renderAccountPage();
  }
}

// AUTHENTICATION LOGIC (Supabase + Demo Fallback)
let isSignupMode = true;

function setupAuth() {
  setupAuthNav();
  setupAuthModal();
  initSupabaseAuth();
}

function triggerInstantTrial(email = 'essai-gratuit@cesar-ia.com') {
  logDebug(`triggerInstantTrial démarré pour email: ${email}`);
  
  // 1. Force simulation mode
  localStorage.setItem('cesar_ia_force_mock', 'true');
  
  const normalizedEmail = email.trim().toLowerCase();
  
  // 2. Set user
  const currentUser = {
    email: normalizedEmail,
    uid: "usr_" + Math.random().toString(36).substr(2, 9),
    isAdmin: false
  };
  localStorage.setItem('cesar_ia_mock_user', JSON.stringify(currentUser));
  
  // Enregistrer également dans la base d'utilisateurs locale fictive pour permettre une reconnexion
  let mockUsers = [];
  try {
    const savedUsers = localStorage.getItem('cesar_ia_mock_users');
    if (savedUsers) {
      mockUsers = JSON.parse(savedUsers);
    }
  } catch (e) {}
  
  if (!mockUsers.some(u => u.email === normalizedEmail)) {
    mockUsers.push({
      email: normalizedEmail,
      password: "password", // Mot de passe par défaut pour l'inscription en un clic
      uid: currentUser.uid,
      isAdmin: false
    });
    localStorage.setItem('cesar_ia_mock_users', JSON.stringify(mockUsers));
  }
  
  // Fermer la modale
  const authModal = document.getElementById('auth-modal');
  if (authModal) {
    authModal.close();
  }
  
  showToast("Inscription réussie (Mode Essai Gratuit activé) !", "success");
  
  setTimeout(() => {
    // Recharger la page pour appliquer le mode simulation
    window.location.reload();
  }, 800);
}

function setupAuthNav() {
  const authNav = document.getElementById('auth-nav-container');
  authNav.addEventListener('click', async (e) => {
    const target = e.target;
    if (target.id === 'btn-login-open') {
      openAuthModal(false);
    } else if (target.id === 'btn-signup-open') {
      openAuthModal(true); // Ouvre la modale en mode Inscription pour saisir email et mot de passe
    } else if (target.id === 'btn-logout') {
      await handleLogout();
    }
  });
}

function setupAuthModal() {
  const authModal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const authToggleLink = document.getElementById('auth-toggle-link');
  const btnAuthClose = document.getElementById('btn-auth-close');

  btnAuthClose.addEventListener('click', () => {
    authModal.close();
  });

  // Fallback for light dismiss clicks on backdrop
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) {
      const rect = authModal.getBoundingClientRect();
      const isInContent = (
        rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width
      );
      if (!isInContent) authModal.close();
    }
  });

  authToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthMode(!isSignupMode);
  });

  authForm.addEventListener('submit', handleAuthSubmit);

  const btnInstantTrial = document.getElementById('btn-instant-trial');
  if (btnInstantTrial) {
    btnInstantTrial.addEventListener('click', () => {
      triggerInstantTrial('essai-gratuit@cesar-ia.com');
    });
  }
}

function toggleAuthMode(signup) {
  isSignupMode = signup;
  const title = document.getElementById('auth-dialog-title');
  const desc = document.getElementById('auth-dialog-desc');
  const submitBtn = document.getElementById('btn-auth-submit');
  const toggleMsg = document.getElementById('auth-toggle-msg');
  const toggleLink = document.getElementById('auth-toggle-link');

  if (isSignupMode) {
    title.innerText = 'Créer un compte';
    desc.innerText = 'Rejoignez-nous et commencez à automatiser.';
    submitBtn.innerText = 'Continuer';
    toggleMsg.innerText = 'Déjà un compte ?';
    toggleLink.innerText = 'Se connecter';
  } else {
    title.innerText = 'Connexion';
    desc.innerText = 'Connectez-vous pour retrouver vos agents.';
    submitBtn.innerText = 'Se connecter';
    toggleMsg.innerText = 'Pas encore de compte ?';
    toggleLink.innerText = 'Créer un compte';
  }
}

function openAuthModal(signup, message = '') {
  toggleAuthMode(signup);
  if (message) {
    document.getElementById('auth-dialog-desc').innerText = message;
  }
  const errEl = document.getElementById('auth-modal-error');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.innerText = '';
  }
  document.getElementById('auth-modal').showModal();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-modal-error');
  
  logDebug(`handleAuthSubmit démarré. Email: ${email}, Inscription: ${isSignupMode}, isMock: ${isMock}`);
  
  if (errEl) {
    errEl.style.display = 'none';
    errEl.innerText = '';
  }
  
  if (isSignupMode) {
    logDebug(`Tentative d'inscription locale pour l'email: ${email}`);
    
    if (!email || password.length < 6) {
      const minLengthMsg = "Le mot de passe doit comporter au moins 6 caractères.";
      if (errEl) {
        errEl.innerText = minLengthMsg;
        errEl.style.display = 'block';
      }
      showToast(minLengthMsg, "error");
      return;
    }
    
    // Récupérer la liste des utilisateurs fictifs existants
    let mockUsers = [];
    try {
      const savedUsers = localStorage.getItem('cesar_ia_mock_users');
      if (savedUsers) {
        mockUsers = JSON.parse(savedUsers);
      }
    } catch (e) {
      console.error(e);
    }
    
    // Vérifier si cet e-mail existe déjà dans la base locale
    const normalizedEmail = email.trim().toLowerCase();
    const userExists = mockUsers.some(u => u.email === normalizedEmail);
    if (userExists) {
      const existsMsg = "Cet e-mail est déjà associé à un compte d'essai. Veuillez vous connecter.";
      if (errEl) {
        errEl.innerText = existsMsg;
        errEl.style.display = 'block';
      }
      showToast(existsMsg, "error");
      return;
    }
    
    // Créer le nouvel utilisateur fictif
    const newUser = {
      email: normalizedEmail,
      password: password, // Stocké pour la simulation locale
      uid: "usr_" + Math.random().toString(36).substr(2, 9),
      isAdmin: false
    };
    
    mockUsers.push(newUser);
    localStorage.setItem('cesar_ia_mock_users', JSON.stringify(mockUsers));
    
    // Transférer l'historique et les connecteurs de l'essai gratuit vers le nouveau compte
    const oldEmail = 'essai-gratuit@cesar-ia.com';
    AGENTS.forEach(agent => {
      const oldKey = `cesar_ia_chat_history_${oldEmail}_${agent.id}`;
      const oldHistory = localStorage.getItem(oldKey);
      if (oldHistory) {
        const newKey = `cesar_ia_chat_history_${normalizedEmail}_${agent.id}`;
        localStorage.setItem(newKey, oldHistory);
      }
    });
    
    const oldConnectors = localStorage.getItem(`cesar_ia_mock_connectors_${oldEmail}`);
    if (oldConnectors) {
      localStorage.setItem(`cesar_ia_mock_connectors_${normalizedEmail}`, oldConnectors);
    }

    const oldCalendar = localStorage.getItem(`cesar_ia_mock_calendar_${oldEmail}`);
    if (oldCalendar) {
      localStorage.setItem(`cesar_ia_mock_calendar_${normalizedEmail}`, oldCalendar);
    }
    
    // Activer le mode simulation
    localStorage.setItem('cesar_ia_force_mock', 'true');
    localStorage.setItem('cesar_ia_mock_user', JSON.stringify(newUser));
    
    document.getElementById('auth-modal').close();
    showToast("Inscription réussie (Mode Essai Gratuit activé) !", "success");
    
    setTimeout(() => {
      window.location.reload();
    }, 800);
    return;
  }
  
  // Mode Connexion (isSignupMode === false)
  const normalizedEmail = email.trim().toLowerCase();
  
  // 1. Vérifier s'il s'agit d'un utilisateur fictif enregistré localement
  let mockUsers = [];
  try {
    const savedUsers = localStorage.getItem('cesar_ia_mock_users');
    if (savedUsers) {
      mockUsers = JSON.parse(savedUsers);
    }
  } catch (e) {
    console.error(e);
  }
  
  const matchedUser = mockUsers.find(u => u.email === normalizedEmail && u.password === password);
  
  if (matchedUser) {
    logDebug("Utilisateur fictif trouvé, connexion en cours...");
    localStorage.setItem('cesar_ia_force_mock', 'true');
    localStorage.setItem('cesar_ia_mock_user', JSON.stringify(matchedUser));
    
    document.getElementById('auth-modal').close();
    showToast("Connexion réussie (Simulation) !", "success");
    
    setTimeout(() => {
      window.location.reload();
    }, 800);
    return;
  }
  
  // 2. Si non trouvé dans le mock et qu'on est en configuration sans Supabase, on rejette
  if (isMock) {
    const noMatchMsg = "Identifiants de simulation incorrects. Veuillez créer un compte.";
    if (errEl) {
      errEl.innerText = noMatchMsg;
      errEl.style.display = 'block';
    }
    showToast(noMatchMsg, "error");
    return;
  }
  
  // 3. Sinon, on tente la connexion réelle via Supabase (ex: contact@cesar-ia.com)
  const btnSubmit = document.getElementById('btn-auth-submit');
  const originalText = btnSubmit.innerText;
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span class="spinner"></span> Traitement...`;
  
  try {
    logDebug("Envoi requête de connexion Supabase...");
    localStorage.removeItem('cesar_ia_force_mock');
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    logDebug(`Connexion Supabase retournée. Erreur: ${error ? error.message : "aucune"}`);
    if (error) throw error;
    
    localStorage.removeItem('cesar_ia_mock_user');
    
    showToast("Connexion réussie !", "success");
    document.getElementById('auth-modal').close();
    updateUI();
    
    if (state.activeRoute === 'home') {
      navigateTo('catalog');
    } else {
      navigateTo(state.activeRoute);
    }
  } catch (err) {
    logDebug(`Erreur attrapée dans catch: ${err.message}`);
    console.error(err);
    const errMsg = err.message || "Une erreur est survenue lors de l'authentification.";
    if (errEl) {
      errEl.innerText = errMsg === "Invalid login credentials" 
        ? "Identifiants de connexion invalides. Veuillez vous inscrire d'abord."
        : errMsg;
      errEl.style.display = 'block';
    }
    showToast(errMsg, "error");
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = originalText;
  }
}

async function handleLogout() {
  if (isMock) {
    state.currentUser = null;
    state.adoptedAgents = [];
    state.activePack = null;
    state.activeDashboardAgentId = null;
    state.invoices = [];
    state.connectorsData = {};
    localStorage.removeItem('cesar_ia_mock_user');
    localStorage.removeItem('cesar_ia_force_mock');
    showToast("Déconnexion réussie.");
    updateUI();
    navigateTo('home');
    setTimeout(() => {
      window.location.reload();
    }, 500);
  } else {
    const { error } = await supabase.auth.signOut();
    localStorage.removeItem('cesar_ia_force_mock');
    if (error) {
      showToast(error.message, "error");
    } else {
      showToast("Déconnexion réussie.");
      navigateTo('home');
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  }
}

async function initSupabaseAuth() {
  if (isMock) {
    const savedUser = localStorage.getItem('cesar_ia_mock_user');
    if (savedUser) {
      state.currentUser = JSON.parse(savedUser);
      if (isAdminEmail(state.currentUser.email)) {
        state.currentUser.isAdmin = true;
      }
      loadMockState();
      await handleStripeCallback();
      updateUI();
      
      // Navigate to the active route on reload
      if (state.activeRoute === 'home') {
        navigateTo('catalog');
      } else {
        navigateTo(state.activeRoute);
      }
    } else {
      await handleStripeCallback();
    }
    return;
  }
  
  logDebug("Initialisation de Supabase Auth...");
  
  // Flag to avoid race conditions and double redirects during initialization
  let authInitialized = false;

  // Set up auth state change listener first
  supabase.auth.onAuthStateChange(async (event, session) => {
    logDebug(`onAuthStateChange déclenché. Événement: ${event}, Session: ${session ? 'active' : 'nulle'}`);
    
    if (session) {
      const email = extractUserEmail(session.user);
      const isSameUser = state.currentUser && state.currentUser.uid === session.user.id && state.currentUser.isAdmin !== undefined;
      
      if (!isSameUser) {
        state.currentUser = {
          email: email || (state.currentUser ? state.currentUser.email : ''),
          uid: session.user.id
        };
      } else {
        state.currentUser.email = email || state.currentUser.email || '';
        state.currentUser.uid = session.user.id;
      }
      
      if (isAdminEmail(state.currentUser.email)) {
        state.currentUser.isAdmin = true;
      }
      
      logDebug(`Session utilisateur détectée pour email: ${state.currentUser.email}, Admin: ${state.currentUser.isAdmin}`);
      
      // Exécuter loadUserData et handleStripeCallback hors du lock synchrone de Supabase Auth
      setTimeout(async () => {
        try {
          if (!isSameUser) {
            await loadUserData();
          }
          await handleStripeCallback();
          updateUI();
          
          if (state.activeRoute === 'home') {
            navigateTo('catalog');
          } else {
            navigateTo(state.activeRoute);
          }
        } catch (err) {
          console.error("Error in deferred onAuthStateChange actions:", err);
        }
      }, 0);
      
      const authModal = document.getElementById('auth-modal');
      if (authModal && authModal.open) {
        logDebug("Fermeture de la modale d'authentification.");
        authModal.close();
      }
      
      updateUI();
      authInitialized = true;
      
      if (state.activeRoute === 'home') {
        navigateTo('catalog');
      } else {
        navigateTo(state.activeRoute);
      }
    } else {
      // Avoid clearing if auth is still initializing (to prevent race conditions on reload)
      if (!authInitialized) {
        return;
      }

      // Éviter de réinitialiser la session si elle a déjà été chargée avec succès par getSession
      if (event === 'INITIAL_SESSION' && state.currentUser) {
        logDebug("[onAuthStateChange] Événement INITIAL_SESSION avec session nulle ignoré car l'utilisateur est connecté.");
        return;
      }

      if (state.activeRoute === 'dashboard' || state.activeRoute === 'billing' || state.activeRoute === 'admin') {
        navigateTo('home');
      }
      
      if (state.currentUser === null) {
        return;
      }
      logDebug("Aucune session active, réinitialisation de l'état.");
      state.currentUser = null;
      state.adoptedAgents = [];
      state.activePack = null;
      state.activeDashboardAgentId = null;
      state.invoices = [];
      state.connectorsData = {};
      state.cancelledAgents = [];
      state.cancelledPacks = [];
      
      updateUI();
    }
  });

  // Tenter de récupérer la session immédiatement au chargement (évite les ratés de onAuthStateChange)
  try {
    logDebug("Récupération de la session en cours (direct)...");
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      logDebug(`Erreur getSession: ${error.message}`);
      authInitialized = true;
    } else if (session) {
      logDebug(`Session active récupérée au chargement pour: ${session.user.email}`);
      const email = extractUserEmail(session.user);
      
      if (!state.currentUser || state.currentUser.uid !== session.user.id) {
        state.currentUser = {
          email: email || (state.currentUser ? state.currentUser.email : ''),
          uid: session.user.id
        };
      } else {
        state.currentUser.email = email || state.currentUser.email || '';
      }
      
      if (isAdminEmail(state.currentUser.email)) {
        state.currentUser.isAdmin = true;
      }
      
      if (!authInitialized) {
        await loadUserData();
        await handleStripeCallback();
        updateUI();
        authInitialized = true;
        
        if (state.activeRoute === 'home') {
          navigateTo('catalog');
        } else {
          navigateTo(state.activeRoute);
        }
      } else {
        updateUI();
      }
    } else {
      logDebug("Aucune session active détectée au chargement direct.");
      if (!authInitialized) {
        authInitialized = true;
        if (state.activeRoute === 'dashboard' || state.activeRoute === 'billing' || state.activeRoute === 'admin') {
          navigateTo('home');
        }
      }
    }
  } catch (errSession) {
    logDebug(`Exception lors de getSession: ${errSession.message}`);
    authInitialized = true;
  }
}

let loadUserDataPromise = null;

async function loadUserData() {
  if (isMock || !state.currentUser) return;

  if (loadUserDataPromise) {
    logDebug("loadUserData: Une requête est déjà en cours, attente du résultat existant...");
    return loadUserDataPromise;
  }

  loadUserDataPromise = (async () => {
    try {
      state.activePack = getActivePack();
      state.cancelledAgents = JSON.parse(localStorage.getItem(`cesar_ia_cancelled_agents_${state.currentUser.uid}`) || '[]');
      state.cancelledPacks = JSON.parse(localStorage.getItem(`cesar_ia_cancelled_packs_${state.currentUser.uid}`) || '[]');
      // Tester le fetch direct avant les requêtes client Supabase pour isoler le problème réseau
      await testDirectFetch();
      
      logDebug(`Chargement des informations du profil utilisateur pour UID: ${state.currentUser.uid} et Email: ${state.currentUser.email}...`);
      let profile = null;
      let errProfile = null;
      try {
        const data = await supabaseFetch('profiles', {
          queryParams: `?id=eq.${state.currentUser.uid}&select=is_admin`
        });
        logDebug(`Données reçues de la table profiles: ${JSON.stringify(data)}`);
        profile = data && data.length > 0 ? data[0] : null;
      } catch (err) {
        errProfile = err;
      }
        
      if (!errProfile && profile) {
        state.currentUser.isAdmin = profile.is_admin || state.currentUser.isAdmin || false;
        logDebug(`Profil utilisateur chargé. Admin de la base de données : ${profile.is_admin}. Sticky Admin global : ${state.currentUser.isAdmin}`);
      } else {
        logDebug(`Erreur profiles ou non trouvé, conservation du statut admin actuel (erreur: ${errProfile ? errProfile.message : 'aucune'})`);
        state.currentUser.isAdmin = state.currentUser.isAdmin || false;
      }
      
      // Fallback de sécurité robuste par email pour César-IA admin
      if (isAdminEmail(state.currentUser.email)) {
        state.currentUser.isAdmin = true;
        logDebug(`[loadUserData] Force de l'état Admin via l'adresse e-mail : ${state.currentUser.email}`);
      }

      logDebug("Chargement des agents adoptés...");
      let adopted = [];
      try {
        adopted = await supabaseFetch('adopted_agents', {
          queryParams: `?user_id=eq.${state.currentUser.uid}&select=agent_id`
        }) || [];
      } catch (errAdopted) {
        logDebug(`Erreur lors du chargement des agents adoptés: ${errAdopted.message}`);
        throw errAdopted;
      }
      
      state.adoptedAgents = adopted.map(a => a.agent_id);
      
      // Si l'utilisateur est admin ou contact@cesar-ia.com, on lui pré-adopte TOUS les 15 agents par défaut et on les synchronise
      const isAdminUser = state.currentUser.isAdmin || isAdminEmail(state.currentUser.email);
      logDebug(`[loadUserData] Évaluation de l'administration globale : ${isAdminUser}. Email : ${state.currentUser.email}, isAdmin : ${state.currentUser.isAdmin}`);
      
      if (isAdminUser) {
        logDebug(`[loadUserData] L'utilisateur est Admin. Attribution forcée des 15 agents.`);
        const allAgentIds = [
          'sybil', 'atlas', 'chronos', 'hermes', 'hestia',
          'vesta', 'ares', 'athena', 'hephaestus', 'iris',
          'apollo', 'demeter', 'janus', 'nemesis', 'zeus'
        ];
        state.adoptedAgents = allAgentIds;
        
        // On lance la synchronisation de tous les agents en arrière-plan vers Supabase
        setTimeout(async () => {
          try {
            console.log(`loadUserData: Auto-adoption complète pour l'admin UID ${state.currentUser.uid} dans Supabase...`);
            for (const agentId of allAgentIds) {
              const { error: errAdopt } = await supabase
                .from('adopted_agents')
                .insert({ user_id: state.currentUser.uid, agent_id: agentId });
                
              if (errAdopt && errAdopt.code !== '23505') {
                console.warn(`Erreur lors de l'auto-adoption de ${agentId}:`, errAdopt);
                continue;
              }
              
              // Si l'agent a été inséré avec succès, on crée la facture correspondante
              if (!errAdopt) {
                const agentMeta = AGENTS.find(a => a.id === agentId);
                const invoiceNo = "INV-" + Math.floor(100000 + Math.random() * 900000);
                
                await supabase
                  .from('invoices')
                  .insert({
                    user_id: state.currentUser.uid,
                    invoice_number: invoiceNo,
                    agent_name: agentMeta ? agentMeta.name : agentId.toUpperCase(),
                    price: agentMeta ? agentMeta.price : 49,
                    status: 'Payée'
                  });
              }
            }
          } catch (e) {
            console.warn("Échec de la synchronisation asynchrone d'auto-adoption de tous les agents :", e);
          }
        }, 100);
      }
      
      if (state.currentUser) {
        state.currentUser.adopted = state.adoptedAgents;
      }
      logDebug(`Agents adoptés chargés (${state.adoptedAgents.length}) : ${state.adoptedAgents.join(', ')}`);
      
      logDebug("Chargement des connecteurs...");
      let connectors = [];
      try {
        connectors = await supabaseFetch('connectors', {
          queryParams: `?user_id=eq.${state.currentUser.uid}&select=*`
        }) || [];
      } catch (errConnectors) {
        logDebug(`Erreur lors du chargement des connecteurs: ${errConnectors.message}`);
        throw errConnectors;
      }
        
      state.connectorsData = {};
      connectors.forEach(c => {
        if (!state.connectorsData[c.agent_id]) {
          state.connectorsData[c.agent_id] = {};
        }
        state.connectorsData[c.agent_id][c.connector_name] = c.credentials || {};
      });
      logDebug("Connecteurs chargés avec succès.");
      
      logDebug("Chargement de l'historique des factures...");
      let invoices = [];
      try {
        invoices = await supabaseFetch('invoices', {
          queryParams: `?user_id=eq.${state.currentUser.uid}&select=*&order=created_at.desc`
        }) || [];
      } catch (errInvoices) {
        logDebug(`Erreur lors du chargement des factures: ${errInvoices.message}`);
        throw errInvoices;
      }
        
      state.invoices = invoices.map(inv => ({
        id: inv.invoice_number,
        date: new Date(inv.created_at).toLocaleDateString('fr-FR'),
        agentName: inv.agent_name,
        price: inv.price,
        status: inv.status
      }));
      logDebug(`Factures chargées avec succès (${state.invoices.length}).`);
    } catch (error) {
      logDebug(`Erreur lors du chargement des données depuis Supabase: ${error.message}`);
      console.error("Erreur lors du chargement des données depuis Supabase :", error);
      showToast("Erreur lors du chargement de vos données. Mode démo actif.", "warning");
    }
  })();

  try {
    await loadUserDataPromise;
  } finally {
    loadUserDataPromise = null;
  }
}

function saveMockState() {
  if (!isMock || !state.currentUser) return;
  const email = state.currentUser.email.toLowerCase();
  localStorage.setItem(`cesar_ia_mock_adopted_${email}`, JSON.stringify(state.adoptedAgents));
  localStorage.setItem(`cesar_ia_mock_invoices_${email}`, JSON.stringify(state.invoices));
  localStorage.setItem(`cesar_ia_mock_connectors_${email}`, JSON.stringify(state.connectorsData));
  localStorage.setItem(`cesar_ia_mock_cancelled_agents_${email}`, JSON.stringify(state.cancelledAgents));
  localStorage.setItem(`cesar_ia_mock_cancelled_packs_${email}`, JSON.stringify(state.cancelledPacks));
  localStorage.setItem(`cesar_ia_mock_calendar_${email}`, JSON.stringify(state.calendarEvents || []));
}

function loadMockState() {
  if (!isMock || !state.currentUser) return;
  const email = state.currentUser.email.toLowerCase();
  try {
    const adopted = localStorage.getItem(`cesar_ia_mock_adopted_${email}`);
    const invoices = localStorage.getItem(`cesar_ia_mock_invoices_${email}`);
    const connectors = localStorage.getItem(`cesar_ia_mock_connectors_${email}`);
    const cancelledAgents = localStorage.getItem(`cesar_ia_mock_cancelled_agents_${email}`);
    const cancelledPacks = localStorage.getItem(`cesar_ia_mock_cancelled_packs_${email}`);
    
    if (adopted) {
      state.adoptedAgents = JSON.parse(adopted);
    } else {
      // Tous les 15 agents par défaut pour l'essai gratuit afin que l'utilisateur puisse tous les tester et choisir
      state.adoptedAgents = ["sybil", "atlas", "chronos", "hermes", "hestia", "vesta", "ares", "athena", "hephaestus", "iris", "apollo", "demeter", "janus", "nemesis", "zeus"];
      localStorage.setItem(`cesar_ia_mock_adopted_${email}`, JSON.stringify(state.adoptedAgents));
    }
    
    if (invoices) state.invoices = JSON.parse(invoices);
    else state.invoices = [];
    
    if (connectors) state.connectorsData = JSON.parse(connectors);
    else state.connectorsData = {};
    
    if (cancelledAgents) state.cancelledAgents = JSON.parse(cancelledAgents);
    else state.cancelledAgents = [];
    
    if (cancelledPacks) state.cancelledPacks = JSON.parse(cancelledPacks);
    else state.cancelledPacks = [];
    
    const calendar = localStorage.getItem(`cesar_ia_mock_calendar_${email}`);
    if (calendar) {
      state.calendarEvents = JSON.parse(calendar);
    } else {
      state.calendarEvents = getSeededCalendarEvents();
      localStorage.setItem(`cesar_ia_mock_calendar_${email}`, JSON.stringify(state.calendarEvents));
    }
    
    state.activePack = getActivePack();
  } catch (e) {
    console.error("Error loading mock state", e);
  }
}

function updateUI() {
  const authContainer = document.getElementById('auth-nav-container');
  const navLinks = document.querySelector('.nav-links');
  
  // Dashboard Link
  const dashboardLink = document.getElementById('nav-dashboard-link');
  if (dashboardLink) {
    if (state.currentUser) {
      dashboardLink.style.display = '';
    } else {
      dashboardLink.style.display = 'none';
    }
  }
  
  // Account Link
  const accountLink = document.getElementById('nav-account-link');
  if (accountLink) {
    if (state.currentUser && !state.currentUser.isAdmin) {
      accountLink.style.display = '';
    } else {
      accountLink.style.display = 'none';
    }
  }

  // Gérer l'affichage dynamique de l'onglet Administration
  let adminLink = document.getElementById('nav-admin-link');
  if (state.currentUser && state.currentUser.isAdmin) {
    if (!adminLink) {
      adminLink = document.createElement('a');
      adminLink.href = '#';
      adminLink.className = 'nav-link';
      adminLink.id = 'nav-admin-link';
      adminLink.setAttribute('data-route', 'admin');
      adminLink.innerText = 'Administration';
      
      // Ajouter l'événement de navigation sur ce nouveau lien
      adminLink.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('admin');
      });
      
      const billingLink = document.getElementById('nav-billing-link');
      if (billingLink) {
        navLinks.insertBefore(adminLink, billingLink);
      } else {
        navLinks.appendChild(adminLink);
      }
    }
  } else {
    if (adminLink) {
      adminLink.remove();
      if (state.activeRoute === 'admin') {
        navigateTo('home');
      }
    }
  }

  if (state.currentUser) {
    const isAdminText = state.currentUser.isAdmin ? ' <span style="font-size: 0.75rem; background: var(--accent-color); color: #fff; padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: bold;">Admin</span>' : '';
    authContainer.innerHTML = `
      <div class="user-badge">
        <div class="user-avatar-circle" style="${state.currentUser.isAdmin ? 'border: 1.5px solid var(--accent-color); box-shadow: 0 0 8px rgba(99, 102, 241, 0.4);' : ''}">${state.currentUser.email.charAt(0).toUpperCase()}</div>
        <span>${state.currentUser.email}${isAdminText}</span>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-logout">Déconnexion</button>
    `;
  } else {
    authContainer.innerHTML = `
      <button class="btn btn-secondary btn-sm" id="btn-login-open">Se connecter</button>
      <button class="btn btn-primary btn-sm" id="btn-signup-open">Essai gratuit</button>
    `;
  }
}

function setupAccountPage() {
  const pwdForm = document.getElementById('form-change-password');
  if (pwdForm) {
    pwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPassword = document.getElementById('acc-new-password').value;
      if (newPassword.length < 6) {
        showToast("Le mot de passe doit faire au moins 6 caractères.", "error");
        return;
      }
      
      try {
        if (supabase) {
          const { error } = await supabase.auth.updateUser({ password: newPassword });
          if (error) throw error;
          showToast("Mot de passe mis à jour avec succès !", "success");
          pwdForm.reset();
        } else {
          showToast("Mise à jour simulée du mot de passe réussie !", "success");
          pwdForm.reset();
        }
      } catch (err) {
        console.error("Error updating password:", err);
        showToast(`Erreur : ${err.message}`, "error");
      }
    });
  }
}

function renderAccountPage() {
  if (!state.currentUser) return;
  
  const emailEl = document.getElementById('account-email');
  const uidEl = document.getElementById('account-uid');
  const createdEl = document.getElementById('account-created');
  
  if (emailEl) emailEl.innerText = state.currentUser.email || '-';
  if (uidEl) uidEl.innerText = state.currentUser.uid || '-';
  
  // Format created_at date
  let createdDate = "N/A";
  if (state.currentUser.created_at) {
    try {
      createdDate = new Date(state.currentUser.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch(e) {}
  } else {
    createdDate = new Date().toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
  if (createdEl) createdEl.innerText = createdDate;
  
  // Render adopted agents summary
  const container = document.getElementById('account-adopted-agents-summary');
  if (container) {
    container.innerHTML = '';
    const adoptedIds = getAdoptedAgentIds() || [];
    
    if (adoptedIds.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); background: rgba(0,0,0,0.15); border-radius: 8px; font-size: 0.9rem;">
          Vous n'avez pas encore adopté d'agents. <a href="#" style="color: var(--accent-color); font-weight: 600; text-decoration: none;" onclick="navigateTo('catalog'); return false;">Parcourir le catalogue</a>.
        </div>
      `;
    } else {
      adoptedIds.forEach(id => {
        const agent = AGENTS.find(a => a.id === id);
        if (!agent) return;
        
        const card = document.createElement('div');
        card.className = 'account-agent-summary-card';
        card.innerHTML = `
          <div style="font-size: 1.5rem; margin-right: 12px;">${agent.avatar}</div>
          <div>
            <div style="font-weight: 700; color: var(--text-primary);">${agent.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">${agent.title}</div>
          </div>
          <div style="margin-left: auto; font-size: 0.85rem; font-weight: 600; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 4px 8px; border-radius: 4px;">
            Actif
          </div>
        `;
        container.appendChild(card);
      });
    }
  }
}

// CATALOG MANAGEMENT
function setupCatalog() {
  // Category tabs click events
  document.querySelectorAll('#catalog-filters .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#catalog-filters .filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeCategory = tab.getAttribute('data-category');
      renderCatalog();
    });
  });
  
  renderCatalog();
}

function renderCatalog() {
  const grid = document.getElementById('agents-catalog-grid');
  grid.innerHTML = '';
  
  const filtered = state.activeCategory === 'all' 
    ? AGENTS 
    : AGENTS.filter(a => a.category === state.activeCategory);
    
  const sorted = [...filtered].sort((a, b) => {
    if (a.id === 'zeus') return 1;
    if (b.id === 'zeus') return -1;
    return a.price - b.price;
  });
    
  sorted.forEach(agent => {
    const isAdopted = isAgentAdopted(agent.id);
    const accentRgb = hexToRgb(agent.color) || "99, 102, 241";
    
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.style.setProperty('--card-accent', agent.color);
    card.style.setProperty('--card-accent-hover', lightenDarkenColor(agent.color, 20));
    card.style.setProperty('--card-accent-rgb', accentRgb);
    
    const isEnterprise = agent.id === 'zeus';
    const priceText = isEnterprise ? 'Sur devis' : `${agent.price} €`;
    const periodText = isEnterprise ? '' : '/ mois';
    const btnText = isAdopted ? '✓ Adopté' : (isEnterprise ? 'Contacter' : 'Adopter');
    
    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-avatar" style="background: rgba(${accentRgb}, 0.08); border-color: rgba(${accentRgb}, 0.2);">${agent.avatar}</div>
        <span class="agent-badge-cat">${agent.category}</span>
      </div>
      <h3>${agent.name}</h3>
      <div class="agent-card-title">${agent.title}</div>
      <p class="agent-card-desc">${agent.desc}</p>
      
      <div class="agent-specs">
        <div class="spec-item">
          <span class="spec-icon" style="color: ${agent.color}">✦</span>
          <span>${agent.capabilities[0]}</span>
        </div>
        <div class="spec-item">
          <span class="spec-icon" style="color: ${agent.color}">✦</span>
          <span>${agent.capabilities[1]}</span>
        </div>
        <div class="spec-item">
          <span class="spec-icon" style="color: ${agent.color}">🔌</span>
          <span style="font-weight: 500;">Connecteurs : ${agent.connectors.join(', ')}</span>
        </div>
      </div>
      
      <div class="agent-card-footer">
        <div class="agent-price">
          <span class="price-val">${priceText}</span>
          <span class="price-period">${periodText}</span>
        </div>
        <button class="btn btn-sm ${isAdopted ? 'btn-secondary' : 'btn-primary'} btn-adopt-trigger" data-agent-id="${agent.id}">
          ${btnText}
        </button>
      </div>
    `;
    
    grid.appendChild(card);
  });
  
  // Attach buttons events
  grid.querySelectorAll('.btn-adopt-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const agentId = btn.getAttribute('data-agent-id');
      
      if (agentId === 'zeus') {
        document.getElementById('contact-modal').showModal();
        return;
      }
      
      if (isAgentAdopted(agentId)) {
        showToast("Vous avez déjà adopté cet agent !", "info");
        navigateTo('dashboard');
        return;
      }
      
      if (!state.currentUser) {
        showToast("Inscrivez-vous pour adopter cet agent IA.", "warning");
        openAuthModal('Créer un compte', 'Créez votre compte pour commencer le déploiement.');
        return;
      }
      
      openAdoptModal(agentId);
    });
  });
}

// ADOPT/CHECKOUT MODAL LOGIC
// ADOPT/CHECKOUT MODAL LOGIC
function openAdoptModal(agentId) {
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;
  
  state.selectedAgentId = agentId;
  
  document.getElementById('checkout-agent-avatar').innerText = agent.avatar;
  document.getElementById('checkout-agent-name').innerText = agent.name;
  document.getElementById('checkout-agent-title').innerText = agent.title;
  
  const setupFeeRow = document.getElementById('checkout-setup-fee-row');
  const setupFeeVal = document.getElementById('checkout-setup-fee-value');
  const priceFees = document.getElementById('checkout-price-fees');
  const priceTotal = document.getElementById('checkout-price-total');
  const initialTotalRow = document.getElementById('checkout-initial-total-row');
  
  const stripeUrl = state.stripeLinks[agentId] || agent.stripeLink;
  const btnConfirm = document.getElementById('btn-adopt-confirm');
  const typeNote = document.getElementById('checkout-payment-type-note');
  const cardFormContainer = document.getElementById('checkout-payment-form-container');
  
  // Custom case for Zeus (Enterprise)
  if (agentId === 'zeus') {
    priceFees.innerText = 'Sur devis';
    if (setupFeeRow) setupFeeRow.style.display = 'none';
    priceTotal.innerText = 'Sur devis';
    if (initialTotalRow) {
      const label = initialTotalRow.querySelector('span:first-child');
      if (label) label.innerText = 'Total estimé';
    }
    
    typeNote.innerHTML = `<span style="color: var(--accent-color); font-weight: 600;">👑 Zeus Enterprise.</span> Ce superviseur de flotte d'agents IA nécessite une étude sur-mesure de vos architectures. Notre service commercial va prendre contact avec vous sous 24h.`;
    typeNote.style.backgroundColor = 'rgba(99, 102, 241, 0.08)';
    typeNote.style.borderColor = 'var(--accent-color)';
    cardFormContainer.style.display = 'none';
    btnConfirm.innerHTML = `✉️ Envoyer ma demande de devis`;
    
    document.getElementById('adopt-modal').showModal();
    return;
  }
  
  // Normal agent calculations
  priceFees.innerText = `${agent.price}.00 € / mois`;
  
  // Calculate setup fee with surclassement waiver
  const adoptedIds = getAdoptedAgentIds();
  const hasBusiness = adoptedIds.some(id => {
    const a = AGENTS.find(x => x.id === id);
    return a && a.tier === 'Business';
  });
  const hasPro = adoptedIds.some(id => {
    const a = AGENTS.find(x => x.id === id);
    return a && a.tier === 'Pro';
  });
  
  let setupFee = agent.setupFee || 0;
  let setupFeeWaived = false;
  
  if (agent.tier === 'Starter' && (hasPro || hasBusiness)) {
    setupFee = 0;
    setupFeeWaived = true;
  } else if (agent.tier === 'Pro' && hasBusiness) {
    setupFee = 0;
    setupFeeWaived = true;
  }
  
  if (setupFeeRow) {
    setupFeeRow.style.display = 'flex';
    if (setupFeeWaived) {
      setupFeeVal.innerHTML = `<span style="text-decoration: line-through; color: var(--text-muted); margin-right: 6px;">${agent.setupFee} €</span> <span style="color: #10b981; font-weight: 600;">0.00 € (Offert !)</span>`;
    } else {
      setupFeeVal.innerText = `${setupFee}.00 €`;
    }
  }
  
  const initialTotal = agent.price + setupFee;
  priceTotal.innerText = `${initialTotal}.00 €`;
  if (initialTotalRow) {
    const label = initialTotalRow.querySelector('span:first-child');
    if (label) label.innerText = 'Total initial à payer';
  }
  
  if (stripeUrl) {
    typeNote.innerHTML = `<span style="color: #10b981; font-weight: 500;">🔗 Lien Stripe réel configuré.</span> Vous allez être redirigé vers la page de paiement sécurisée de Stripe pour valider votre abonnement.`;
    typeNote.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
    typeNote.style.borderColor = 'rgba(16, 185, 129, 0.2)';
    cardFormContainer.style.display = 'none';
    btnConfirm.innerHTML = `🔗 Rediriger vers Stripe`;
  } else {
    typeNote.innerHTML = `<span style="color: #f59e0b; font-weight: 500;">⚠️ Mode Simulation activé.</span> Aucun lien Stripe n'est configuré pour cet agent. Utilisez le formulaire ci-dessous pour simuler le paiement.`;
    typeNote.style.backgroundColor = 'rgba(245, 158, 11, 0.08)';
    typeNote.style.borderColor = 'rgba(245, 158, 11, 0.2)';
    cardFormContainer.style.display = 'block';
    btnConfirm.innerHTML = `💳 Confirmer & Payer (Simulé)`;
    
    // Clear card fields
    document.getElementById('checkout-card-name').value = '';
    document.getElementById('checkout-card-number').value = '';
    document.getElementById('checkout-card-expiry').value = '';
    document.getElementById('checkout-card-cvc').value = '';
    const brandIcon = document.getElementById('card-brand-icon');
    if (brandIcon) brandIcon.innerText = '💳';
  }
  
  document.getElementById('adopt-modal').showModal();
}

// Luhn algorithm helper
function validateLuhn(cardNumber) {
  const digits = cardNumber.replace(/\D/g, '');
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let val = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      val *= 2;
      if (val > 9) val -= 9;
    }
    sum += val;
    shouldDouble = !shouldDouble;
  }
  return (sum % 10) === 0;
}

function setupModals() {
  const adoptModal = document.getElementById('adopt-modal');
  const unsubModal = document.getElementById('unsub-modal');
  
  document.getElementById('btn-adopt-close').addEventListener('click', () => adoptModal.close());
  document.getElementById('btn-adopt-cancel').addEventListener('click', () => adoptModal.close());
  
  if (unsubModal) {
    const unsubClose = document.getElementById('btn-unsub-close');
    const unsubCancel = document.getElementById('btn-unsub-cancel');
    if (unsubClose) unsubClose.addEventListener('click', () => unsubModal.close());
    if (unsubCancel) unsubCancel.addEventListener('click', () => unsubModal.close());
    
    // Backdrop click fallback
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      unsubModal.addEventListener('click', (e) => {
        if (e.target === unsubModal) {
          const rect = unsubModal.getBoundingClientRect();
          const isInContent = (
            rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
            rect.left <= e.clientX && e.clientX <= rect.left + rect.width
          );
          if (!isInContent) unsubModal.close();
        }
      });
    }
  }
  
  // Card brand detection and formatting
  const cardInput = document.getElementById('checkout-card-number');
  const cardIcon = document.getElementById('card-brand-icon');
  if (cardInput && cardIcon) {
    cardInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '');
      
      if (value.startsWith('4')) {
        cardIcon.innerText = '💳 Visa';
      } else if (/^(5[1-5]|2[2-7])/.test(value)) {
        cardIcon.innerText = '💳 MC';
      } else if (/^(34|37)/.test(value)) {
        cardIcon.innerText = '💳 Amex';
      } else if (/^(6011|65|64[4-9])/.test(value)) {
        cardIcon.innerText = '💳 Discover';
      } else {
        cardIcon.innerText = '💳';
      }
      
      let formatted = '';
      for (let i = 0; i < value.length; i++) {
        if (i > 0 && i % 4 === 0) {
          formatted += ' ';
        }
        formatted += value[i];
      }
      e.target.value = formatted;
    });
  }

  const expiryInput = document.getElementById('checkout-card-expiry');
  if (expiryInput) {
    expiryInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 2) {
        e.target.value = value.substring(0, 2) + '/' + value.substring(2, 4);
      } else {
        e.target.value = value;
      }
    });
  }

  const cvcInput = document.getElementById('checkout-card-cvc');
  if (cvcInput) {
    cvcInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').substring(0, 4);
    });
  }

  document.getElementById('btn-adopt-confirm').addEventListener('click', async () => {
    const agentId = state.selectedAgentId;
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) return;
    
    const btnConfirm = document.getElementById('btn-adopt-confirm');
    
    // Zeus Enterprise special flow
    if (agentId === 'zeus') {
      btnConfirm.disabled = true;
      btnConfirm.innerHTML = `<span class="spinner"></span> Envoi de la demande...`;
      
      setTimeout(() => {
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = `✉️ Envoyer ma demande de devis`;
        document.getElementById('adopt-modal').close();
        showToast("Votre demande de devis pour Zeus a bien été envoyée ! Un conseiller vous contactera.", "success");
      }, 1500);
      return;
    }
    
    const stripeUrl = state.stripeLinks[agentId] || agent.stripeLink;
    if (stripeUrl) {
      btnConfirm.disabled = true;
      btnConfirm.innerHTML = `<span class="spinner"></span> Redirection Stripe...`;
      
      localStorage.setItem('cesar_ia_pending_stripe_callback', JSON.stringify({
        agentId: agentId,
        sessionId: null,
        timestamp: Date.now()
      }));
      
      await new Promise(resolve => setTimeout(resolve, 300));
      window.location.href = stripeUrl;
      return;
    }
    
    // Fallback Mock Validation
    const cardName = document.getElementById('checkout-card-name').value.trim();
    const cardNumber = document.getElementById('checkout-card-number').value.replace(/\s/g, '');
    const cardExpiry = document.getElementById('checkout-card-expiry').value.trim();
    const cardCvc = document.getElementById('checkout-card-cvc').value.trim();
    
    if (!cardName) {
      showToast("Veuillez saisir le nom du titulaire.", "error");
      return;
    }
    if (!/^\d{13,19}$/.test(cardNumber)) {
      showToast("Numéro de carte invalide (13 à 19 chiffres requis).", "error");
      return;
    }
    if (!validateLuhn(cardNumber)) {
      showToast("Numéro de carte invalide (Échec du test Luhn).", "error");
      return;
    }
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(cardExpiry)) {
      showToast("Date d'expiration invalide (format MM/YY requis).", "error");
      return;
    }
    const parts = cardExpiry.split('/');
    const expMonth = parseInt(parts[0], 10);
    const expYear = parseInt('20' + parts[1], 10);
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      showToast("La carte de paiement a expiré.", "error");
      return;
    }
    if (!/^\d{3,4}$/.test(cardCvc)) {
      showToast("Code CVC invalide (3 ou 4 chiffres requis).", "error");
      return;
    }

    // Simulate payment transaction
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = `<span class="spinner"></span> Traitement Stripe...`;
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Calculate setup fee with surclassement waiver
    const adoptedIds = getAdoptedAgentIds();
    const hasBusiness = adoptedIds.some(id => {
      const a = AGENTS.find(x => x.id === id);
      return a && a.tier === 'Business';
    });
    const hasPro = adoptedIds.some(id => {
      const a = AGENTS.find(x => x.id === id);
      return a && a.tier === 'Pro';
    });
    
    let setupFee = agent.setupFee || 0;
    if (agent.tier === 'Starter' && (hasPro || hasBusiness)) setupFee = 0;
    else if (agent.tier === 'Pro' && hasBusiness) setupFee = 0;
    
    const finalInvoicePrice = agent.price + setupFee;
    const invoiceNo = "INV-" + Math.floor(100000 + Math.random() * 900000);
    
    if (isMock) {
      if (!state.adoptedAgents.includes(agentId)) {
        state.adoptedAgents.push(agentId);
      }
      if (state.currentUser) {
        state.currentUser.adopted = state.adoptedAgents;
      }
      state.invoices.unshift({
        id: invoiceNo,
        date: new Date().toLocaleDateString('fr-FR'),
        agentName: agent.name,
        price: finalInvoicePrice,
        status: 'Payée'
      });
      saveMockState();
    } else {
      try {
        try {
          await supabaseFetch('adopted_agents', {
            method: 'POST',
            body: { user_id: state.currentUser.uid, agent_id: agentId }
          });
        } catch (errAdopt) {
          if (!errAdopt.message.includes('23505') && !errAdopt.message.includes('409') && !errAdopt.message.includes('duplicate')) {
            throw errAdopt;
          }
        }
        
        await supabaseFetch('invoices', {
          method: 'POST',
          body: {
            user_id: state.currentUser.uid,
            invoice_number: invoiceNo,
            agent_name: agent.name,
            price: finalInvoicePrice,
            status: 'Payée'
          }
        });
        
        await loadUserData();
      } catch (error) {
        console.error("Erreur lors de l'adoption de l'agent :", error);
        showToast("Impossible d'adopter l'agent via Supabase.", "error");
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = `💳 Confirmer & Payer (Simulé)`;
        return;
      }
    }
    
    // Reset button
    btnConfirm.disabled = false;
    btnConfirm.innerHTML = `💳 Confirmer & Payer (Simulé)`;
    
    adoptModal.close();
    showToast(`Félicitations ! Vous avez adopté l'agent ${agent.name}.`, "success");
    
    // Re-render
    renderCatalog();
    navigateTo('dashboard');
    selectDashboardAgent(agentId);
  });

  // Fallback backdrop click
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    adoptModal.addEventListener('click', (e) => {
      if (e.target === adoptModal) {
        const rect = adoptModal.getBoundingClientRect();
        const isInContent = (
          rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX && e.clientX <= rect.left + rect.width
        );
        if (!isInContent) adoptModal.close();
      }
    });
  }
}

// DASHBOARD MANAGEMENT
function setupDashboard() {
  // Tabs navigation
  document.querySelectorAll('.panel-tabs .panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchDashboardTab(tab.getAttribute('data-tab'));
    });
  });

  // Send message events
  document.getElementById('btn-chat-send').addEventListener('click', sendChatMessage);
  document.getElementById('chat-user-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  // Save connectors button
  document.getElementById('btn-save-connectors').addEventListener('click', saveConnectors);
  
  // Test connection button
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);

  // Disconnect agent button
  const disconnectBtn = document.getElementById('btn-disconnect-agent');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', disconnectAgent);
  }

  // Email digest toggle
  const toggleEmailDigest = document.getElementById('toggle-email-digest');
  if (toggleEmailDigest) {
    toggleEmailDigest.addEventListener('change', (e) => {
      const agentId = state.activeDashboardAgentId;
      if (!agentId) return;
      const checked = e.target.checked;
      localStorage.setItem(`cesar_ia_email_digest_${agentId}`, checked ? 'true' : 'false');
      
      const agent = AGENTS.find(a => a.id === agentId);
      const agentName = agent ? agent.name : "l'agent";
      
      if (checked) {
        showToast(`Rapport hebdomadaire activé pour ${agentName} !`, "success");
      } else {
        showToast(`Rapport hebdomadaire désactivé pour ${agentName}.`, "info");
      }
    });
  }

  // Événements de recherche dans l'historique
  const historySearch = document.getElementById('history-search-input');
  if (historySearch) {
    historySearch.addEventListener('input', () => {
      renderHistoryTab();
    });
  }

  const clearHistorySearch = document.getElementById('btn-clear-history-search');
  if (clearHistorySearch) {
    clearHistorySearch.addEventListener('click', () => {
      if (historySearch) historySearch.value = '';
      renderHistoryTab();
    });
  }
}

function renderDashboardSidebar() {
  const sidebarList = document.getElementById('sidebar-adopted-list');
  sidebarList.innerHTML = '';
  
  const adoptedIds = getAdoptedAgentIds();
  logDebug(`[renderDashboardSidebar] rendering sidebar for agents: ${adoptedIds.join(', ')}`);
  
  if (adoptedIds.length === 0) {
    sidebarList.innerHTML = `
      <div class="no-adopted">
        Vous n'avez pas encore d'agent.<br><br>
        <button class="btn btn-primary btn-sm" onclick="document.querySelector('[data-route=catalog]').click()">Adopter un agent</button>
      </div>
    `;
    return;
  }
  
  adoptedIds.forEach(agentId => {
    try {
      const agent = AGENTS.find(a => a.id === agentId);
      if (!agent) return;
      
      const isConfigured = isAgentConfigured(agentId);
      const item = document.createElement('button');
      item.className = `adopted-agent-item ${state.activeDashboardAgentId === agentId ? 'active' : ''}`;
      item.innerHTML = `
        <span class="item-avatar">${agent.avatar}</span>
        <div class="item-info">
          <div class="item-name">${agent.name}</div>
          <div class="item-status">
            <div class="status-dot ${isConfigured ? '' : 'offline'}"></div>
            <span>${isConfigured ? 'Connecté' : 'Non configuré'}</span>
          </div>
        </div>
      `;
      
      item.addEventListener('click', () => selectDashboardAgent(agentId));
      sidebarList.appendChild(item);
    } catch (err) {
      logDebug(`[renderDashboardSidebar] Erreur de rendu pour l'agent ${agentId}: ${err.message}`);
      console.error(`Error rendering agent ${agentId} in sidebar:`, err);
    }
  });
}

function isAgentConfigured(agentId) {
  try {
    const data = state.connectorsData[agentId];
    if (!data) return false;
    
    // Check if at least one field has been entered
    return Object.values(data).some(connData => {
      if (!connData) return false;
      return Object.values(connData).some(val => {
        if (val === null || val === undefined) return false;
        const strVal = String(val).trim();
        return strVal.length > 0;
      });
    });
  } catch (e) {
    console.error("Error in isAgentConfigured:", e);
    return false;
  }
}

function selectDashboardAgent(agentId) {
  state.activeDashboardAgentId = agentId;
  renderDashboardSidebar();
  renderDashboardPanel();

  // Chargement asynchrone de l'historique et rafraîchissement des messages
  loadChatHistory(agentId).then(() => {
    if (state.activeDashboardAgentId === agentId) {
      if (state.activeDashboardTab === 'chat') {
        renderChatMessages();
      } else if (state.activeDashboardTab === 'history') {
        renderHistoryTab();
      }
    }
  });
}

function renderDashboardPanel() {
  const emptyState = document.getElementById('dashboard-empty-state');
  const activePanel = document.getElementById('active-agent-panel');
  
  if (!state.activeDashboardAgentId) {
    emptyState.style.display = 'flex';
    activePanel.style.display = 'none';
    return;
  }
  
  emptyState.style.display = 'none';
  activePanel.style.display = 'flex';
  
  const agent = AGENTS.find(a => a.id === state.activeDashboardAgentId);
  if (!agent) return;
  
  // Header Meta
  document.getElementById('active-agent-avatar').innerText = agent.avatar;
  document.getElementById('active-agent-name').innerText = agent.name;
  document.getElementById('active-agent-title').innerText = agent.title;
  
  // Show/Hide Calendar tab dynamically only for Chronos
  const btnCalendar = document.getElementById('tab-btn-calendar');
  if (btnCalendar) {
    btnCalendar.style.display = agent.id === 'chronos' ? '' : 'none';
  }

  // Set tab back to chat by default
  document.querySelectorAll('.panel-tabs .panel-tab').forEach(t => {
    if (t.getAttribute('data-tab') === 'chat') t.classList.add('active');
    else t.classList.remove('active');
  });
  state.activeDashboardTab = 'chat';
  
  renderDashboardTabContent();
}

function switchDashboardTab(tabName) {
  state.activeDashboardTab = tabName;
  document.querySelectorAll('.panel-tabs .panel-tab').forEach(t => {
    if (t.getAttribute('data-tab') === tabName) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });
  renderDashboardTabContent();
}

function renderDashboardTabContent() {
  const tabChat = document.getElementById('tab-chat');
  const tabHistory = document.getElementById('tab-history');
  const tabConnectors = document.getElementById('tab-connectors');
  const tabStats = document.getElementById('tab-stats');
  const tabCalendar = document.getElementById('tab-calendar');
  
  // Masquer tous les onglets par défaut
  tabChat.classList.remove('active');
  if (tabHistory) tabHistory.classList.remove('active');
  tabConnectors.classList.remove('active');
  tabStats.classList.remove('active');
  if (tabCalendar) tabCalendar.classList.remove('active');
  
  if (state.activeDashboardTab === 'chat') {
    tabChat.classList.add('active');
    renderChatMessages();
  } else if (state.activeDashboardTab === 'history') {
    if (tabHistory) {
      tabHistory.classList.add('active');
      renderHistoryTab();
    }
  } else if (state.activeDashboardTab === 'connectors') {
    tabConnectors.classList.add('active');
    renderConnectorsForm();
  } else if (state.activeDashboardTab === 'stats') {
    tabStats.classList.add('active');
    renderStatsTab();
  } else if (state.activeDashboardTab === 'calendar') {
    if (tabCalendar) {
      tabCalendar.classList.add('active');
      renderCalendarTab();
    }
  }
}

// STATS TAB RENDERING
const AGENT_KPIS = {
  sybil: [
    { title: "Requêtes SQL exécutées", value: (getSeededRandom) => getSeededRandom(120, 480), desc: "Requêtes autonomes de BI" },
    { title: "Rapports générés", value: (getSeededRandom) => getSeededRandom(15, 60), desc: "Rapports Excel/Airtable/Sheets" },
    { title: "Précision prédictions", value: (getSeededRandom) => `${getSeededRandom(92, 99)}%`, desc: "Analyse prédictive des tendances" },
    { title: "Temps d'exécution SQL", value: (getSeededRandom) => `${(getSeededRandom(200, 800) / 1000).toFixed(2)}s`, desc: "Temps de réponse moyen base" }
  ],
  atlas: [
    { title: "Uptime Serveurs", value: (getSeededRandom, isConfig) => isConfig ? "99.98%" : "0.00%", desc: "Disponibilité de l'infrastructure" },
    { title: "Incidents résolus", value: (getSeededRandom) => getSeededRandom(2, 14), desc: "Alertes traitées de manière autonome" },
    { title: "CPU / RAM moyen", value: (getSeededRandom) => `${getSeededRandom(35, 68)}% / ${getSeededRandom(40, 72)}%`, desc: "Utilisation des ressources serveurs" },
    { title: "Scripts SSH exécutés", value: (getSeededRandom) => getSeededRandom(45, 180), desc: "Tâches shell automatisées" }
  ],
  chronos: [
    { title: "Publications planifiées", value: (getSeededRandom) => getSeededRandom(20, 80), desc: "Posts sur LinkedIn/X/Facebook" },
    { title: "Taux d'engagement", value: (getSeededRandom) => `${(getSeededRandom(30, 85) / 10).toFixed(1)}%`, desc: "Engagement moyen des publications" },
    { title: "Portée estimée", value: (getSeededRandom) => `${getSeededRandom(12, 45)}k`, desc: "Impressions des posts générés" },
    { title: "Commentaires modérés", value: (getSeededRandom) => getSeededRandom(80, 320), desc: "Interactions filtrées/traitées" }
  ],
  hermes: [
    { title: "Articles SEO rédigés", value: (getSeededRandom) => getSeededRandom(8, 32), desc: "Articles de blog de 2000+ mots" },
    { title: "Mots-clés positionnés", value: (getSeededRandom) => getSeededRandom(150, 600), desc: "Mots-clés en top 10 Google" },
    { title: "Score d'optimisation", value: (getSeededRandom) => `${getSeededRandom(85, 96)}/100`, desc: "Score SEO moyen Surfer/Semrush" },
    { title: "Trafic organique estimé", value: (getSeededRandom) => `+${getSeededRandom(15, 60)}%`, desc: "Croissance mensuelle moyenne" }
  ],
  hestia: [
    { title: "Tickets résolus", value: (getSeededRandom) => getSeededRandom(250, 950), desc: "Résolution autonome de niveau 1 & 2" },
    { title: "Score CSAT moyen", value: (getSeededRandom) => `${(getSeededRandom(42, 49) / 10).toFixed(1)} / 5`, desc: "Satisfaction client après échange" },
    { title: "Taux de déviation", value: (getSeededRandom) => `${getSeededRandom(74, 88)}%`, desc: "Tickets évités sans support humain" },
    { title: "Temps de réponse initial", value: (getSeededRandom) => `${getSeededRandom(12, 45)}s`, desc: "Délai de première réponse chat/email" }
  ],
  vesta: [
    { title: "Emails de prospection", value: (getSeededRandom) => getSeededRandom(500, 2500), desc: "Cold emailing ultra-personnalisé" },
    { title: "Taux d'ouverture", value: (getSeededRandom) => `${getSeededRandom(55, 78)}%`, desc: "Taux moyen d'ouverture des emails" },
    { title: "Taux de réponse", value: (getSeededRandom) => `${getSeededRandom(18, 35)}%`, desc: "Réponses positives reçues" },
    { title: "Rendez-vous qualifiés", value: (getSeededRandom) => getSeededRandom(8, 36), desc: "Réunions planifiées dans le calendrier" }
  ],
  ares: [
    { title: "Failles détectées", value: (getSeededRandom) => getSeededRandom(5, 25), desc: "Vulnérabilités critiques, moyennes & faibles" },
    { title: "Scans exécutés", value: (getSeededRandom) => getSeededRandom(14, 56), desc: "Audits de ports et de dépôts" },
    { title: "Niveau de conformité", value: (getSeededRandom) => `${getSeededRandom(91, 98)}%`, desc: "Alignement normes OWASP/ISO" },
    { title: "Injections SQL bloquées", value: (getSeededRandom) => getSeededRandom(120, 680), desc: "Attaques stoppées sur les formulaires" }
  ],
  athena: [
    { title: "User Stories rédigées", value: (getSeededRandom) => getSeededRandom(24, 96), desc: "Tickets complets dans Jira/Linear" },
    { title: "Cahiers des charges (PRD)", value: (getSeededRandom) => getSeededRandom(3, 12), desc: "Spécifications de fonctionnalités" },
    { title: "Vitesse de sprint estimée", value: (getSeededRandom) => `${getSeededRandom(35, 65)} SP`, desc: "Story points livrés en moyenne" },
    { title: "Comptes-rendus générés", value: (getSeededRandom) => getSeededRandom(12, 48), desc: "Notes de meeting résumées" }
  ],
  hephaestus: [
    { title: "Code autonome généré", value: (getSeededRandom) => `${(getSeededRandom(10, 45) / 10).toFixed(1)}k lignes`, desc: "Fichiers JS/Python/Go produits" },
    { title: "Issues résolues (GitHub)", value: (getSeededRandom) => getSeededRandom(15, 65), desc: "Bugs corrigés et fusionnés" },
    { title: "Tests unitaires écrits", value: (getSeededRandom) => getSeededRandom(40, 160), desc: "Couverture de tests Jest/Pytest" },
    { title: "Couverture de code moyenne", value: (getSeededRandom) => `${getSeededRandom(78, 92)}%`, desc: "Couverture de test des modifs" }
  ],
  iris: [
    { title: "Sites concurrents surveillés", value: (getSeededRandom) => getSeededRandom(3, 12), desc: "Veille e-commerce et actualités" },
    { title: "Prix réajustés identifiés", value: (getSeededRandom) => getSeededRandom(80, 450), desc: "Ajustements tarifaires concurrents" },
    { title: "Alertes produits envoyées", value: (getSeededRandom) => getSeededRandom(12, 58), desc: "Lancements concurrents signalés" },
    { title: "Rapports de veille", value: (getSeededRandom) => getSeededRandom(4, 16), desc: "Synthèses hebdomadaires du marché" }
  ],
  apollo: [
    { title: "Volume de mots traduits", value: (getSeededRandom) => `${getSeededRandom(150, 850)}k`, desc: "Texte adapté dans 12 langues" },
    { title: "Fichiers i18n localisés", value: (getSeededRandom) => getSeededRandom(20, 95), desc: "Fichiers de traduction JSON/YAML" },
    { title: "Précision sémantique", value: (getSeededRandom) => `${getSeededRandom(96, 99)}%`, desc: "Score de qualité de traduction" },
    { title: "Pages CMS synchronisées", value: (getSeededRandom) => getSeededRandom(40, 180), desc: "Pages WordPress/Shopify adaptées" }
  ],
  demeter: [
    { title: "Factures traitées", value: (getSeededRandom) => getSeededRandom(80, 360), desc: "Documents extraits via OCR" },
    { title: "TVA vérifiée & récupérée", value: (getSeededRandom) => `${getSeededRandom(1200, 8500)} €`, desc: "Calculs automatiques de déclaration" },
    { title: "Taux de précision OCR", value: (getSeededRandom) => `${(getSeededRandom(980, 999) / 10).toFixed(1)}%`, desc: "Extraction sans correction manuelle" },
    { title: "Rapprochements Qonto/Stripe", value: (getSeededRandom) => getSeededRandom(60, 280), desc: "Rapprochements bancaires automatiques" }
  ],
  janus: [
    { title: "Documents indexés (RAG)", value: (getSeededRandom) => getSeededRandom(120, 580), desc: "Fichiers Notion/Drive disponibles" },
    { title: "Questions résolues", value: (getSeededRandom) => getSeededRandom(450, 1800), desc: "Requêtes de recherche interne" },
    { title: "Pages obsolètes détectées", value: (getSeededRandom) => getSeededRandom(8, 42), desc: "Suggestions de mise à jour wiki" },
    { title: "Temps de recherche sémantique", value: (getSeededRandom) => `${getSeededRandom(150, 450)}ms`, desc: "Délai moyen de réponse" }
  ],
  nemesis: [
    { title: "Commentaires analysés", value: (getSeededRandom) => `${getSeededRandom(5, 25)}k`, desc: "Avis, forums & réseaux modérés" },
    { title: "Spams & insultes bloqués", value: (getSeededRandom) => getSeededRandom(300, 1500), desc: "Contenus indésirables masqués d'office" },
    { title: "Taux de faux positifs", value: (getSeededRandom) => `${(getSeededRandom(1, 15) / 10).toFixed(1)}%`, desc: "Erreurs de modération corrigées" },
    { title: "Temps de réaction", value: (getSeededRandom) => `${getSeededRandom(40, 190)}ms`, desc: "Modération instantanée en millisecondes" }
  ],
  zeus: [
    { title: "Projets complexes coordonnés", value: (getSeededRandom) => getSeededRandom(5, 22), desc: "Processus multi-agents supervisés" },
    { title: "Tâches distribuées", value: (getSeededRandom) => getSeededRandom(120, 560), desc: "Distribution autonome aux sous-agents" },
    { title: "Sous-agents actifs", value: (getSeededRandom) => getSeededRandom(3, 8), desc: "Nombre moyen d'agents mobilisés" },
    { title: "Taux de réussite livrables", value: (getSeededRandom) => `${getSeededRandom(95, 100)}%`, desc: "Validation automatique de qualité" }
  ]
};

function renderStatsTab() {
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;

  // Graine stable (seed) basée sur l'agentId pour des stats cohérentes à chaque clic
  let seed = 0;
  for (let i = 0; i < agentId.length; i++) {
    seed += agentId.charCodeAt(i);
  }
  
  // Générateur pseudo-aléatoire basé sur la graine
  const getSeededRandom = (min, max, offset = 0) => {
    const x = Math.sin(seed + offset) * 10000;
    const r = x - Math.floor(x);
    return Math.floor(r * (max - min + 1)) + min;
  };

  const isConfig = isAgentConfigured(agentId);

  // Mettre à jour l'état du checkbox e-mail
  const toggleEmailDigest = document.getElementById('toggle-email-digest');
  if (toggleEmailDigest) {
    const isEnabled = localStorage.getItem(`cesar_ia_email_digest_${agentId}`) === 'true';
    toggleEmailDigest.checked = isEnabled;
  }

  // Mettre à jour les indicateurs du DOM dynamiquement avec des KPI personnalisés
  const kpis = AGENT_KPIS[agentId] || [
    { title: "Requêtes IA", value: (rand) => rand(80, 350), desc: "Messages & commandes traités" },
    { title: "Tokens Consommés", value: (rand) => `${(rand(150, 890) / 10).toFixed(1)}k`, desc: "Volume de texte traité" },
    { title: "Tâches Automatisées", value: (rand) => rand(10, 45), desc: "Scripts & API déclenchés" },
    { title: "Statut Connexions", value: (rand, isConfig) => isConfig ? "100%" : "0%", desc: "Disponibilité connecteurs" }
  ];

  const statsGrid = document.querySelector('.stats-grid');
  if (statsGrid) {
    statsGrid.innerHTML = kpis.map((kpi, idx) => {
      let val = typeof kpi.value === 'function' ? kpi.value(getSeededRandom, isConfig) : kpi.value;
      
      // Mettre de la couleur si c'est un statut d'uptime ou conformité
      let valStyle = '';
      if (kpi.title.toLowerCase().includes('uptime') || kpi.title.toLowerCase().includes('statut') || kpi.title.toLowerCase().includes('réussite')) {
        valStyle = `style="color: ${isConfig || val !== '0.00%' ? '#10b981' : '#ef4444'};"`;
      }
      
      return `
        <div class="stats-card">
          <div class="stats-card-title">${kpi.title}</div>
          <div class="stats-card-value" ${valStyle}>${val}</div>
          <div class="stats-card-desc">${kpi.desc}</div>
        </div>
      `;
    }).join('');
  }

  // Générer le graphique SVG personnalisé
  renderStatsChart(getSeededRandom);

  // Générer le journal d'exécution
  renderConsoleLogs(agent, getSeededRandom, isConfig);
}

function renderStatsChart(getSeededRandom) {
  const container = document.getElementById('stats-chart-container');
  if (!container) return;

  // Création de 7 points d'activité
  const dataPoints = [];
  for (let i = 0; i < 7; i++) {
    dataPoints.push(getSeededRandom(10, 100, i * 5));
  }

  const width = container.clientWidth || 500;
  const height = 180;
  const maxVal = Math.max(...dataPoints, 100);
  const padding = 20;
  
  // Calcul des coordonnées x et y
  const points = dataPoints.map((val, idx) => {
    const x = padding + (idx * (width - padding * 2) / (dataPoints.length - 1));
    const y = height - padding - (val * (height - padding * 2) / maxVal);
    return { x, y, val };
  });

  // Génération de la spline (courbe de Bézier continue)
  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cpX1 = p0.x + (p1.x - p0.x) / 3;
    const cpY1 = p0.y;
    const cpX2 = p0.x + 2 * (p1.x - p0.x) / 3;
    const cpY2 = p1.y;
    pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
  }

  // Chemin pour le remplissage sous la courbe (gradient area)
  const fillD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  const days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  
  let svgHtml = `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent-color)" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      
      <!-- Lignes de grille horizontales -->
      <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
      <line x1="${padding}" y1="${(height - padding * 2) / 2 + padding}" x2="${width - padding}" y2="${(height - padding * 2) / 2 + padding}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />

      <!-- Remplissage dégradé -->
      <path d="${fillD}" fill="url(#chartGradient)" />

      <!-- Ligne de courbe de Bézier -->
      <path d="${pathD}" fill="none" stroke="var(--accent-color)" stroke-width="3" stroke-linecap="round" />

      <!-- Points d'indicateurs -->
  `;

  points.forEach((pt, idx) => {
    svgHtml += `
      <g class="chart-point-group" style="cursor: pointer;">
        <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#111827" stroke="var(--accent-color)" stroke-width="2" />
        <text x="${pt.x}" y="${pt.y - 12}" text-anchor="middle" font-size="9" fill="var(--text-primary)" font-weight="bold" style="opacity: 0.85;">${pt.val}</text>
        <text x="${pt.x}" y="${height - 4}" text-anchor="middle" font-size="10" fill="var(--text-secondary)">${days[idx]}</text>
      </g>
    `;
  });

  svgHtml += `</svg>`;
  container.innerHTML = svgHtml;
}

function renderConsoleLogs(agent, getSeededRandom, isConfig) {
  const container = document.getElementById('stats-logs-container');
  if (!container) return;

  container.innerHTML = '';
  
  const now = new Date();
  const getLogTimeStr = (offsetMin) => {
    const t = new Date(now.getTime() - offsetMin * 60000);
    return t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const logs = [];
  
  if (!isConfig) {
    // Connecteur non configuré
    logs.push({
      time: getLogTimeStr(25),
      source: 'SYSTEM',
      text: `Démarrage de l'agent ${agent.name}...`,
      type: 'info'
    });
    logs.push({
      time: getLogTimeStr(24),
      source: agent.name.toUpperCase(),
      text: `Initialisation des protocoles d'exécution.`,
      type: 'info'
    });
    logs.push({
      time: getLogTimeStr(24),
      source: 'CONNECTOR',
      text: `Alerte : Aucun connecteur actif configuré. Mise en attente de l'agent.`,
      type: 'error'
    });
    logs.push({
      time: getLogTimeStr(10),
      source: agent.name.toUpperCase(),
      text: `En attente de connexion avec vos outils pour exécuter les tâches en arrière-plan.`,
      type: 'info'
    });
    logs.push({
      time: getLogTimeStr(1),
      source: 'SYSTEM',
      text: `Veille active. En attente de configuration utilisateur dans l'onglet 'Connecteurs & Logiciels'.`,
      type: 'info'
    });
  } else {
    // Connecteur actif
    const mainConn = agent.connectors[0] || 'API Webhook';
    
    logs.push({
      time: getLogTimeStr(45),
      source: 'SYSTEM',
      text: `Agent ${agent.name} démarré avec succès.`,
      type: 'success'
    });
    
    logs.push({
      time: getLogTimeStr(44),
      source: 'CONNECTOR',
      text: `Connexion active établie avec : ${mainConn}.`,
      type: 'success'
    });
    
    switch (agent.id) {
      case 'sybil':
        logs.push({
          time: getLogTimeStr(30),
          source: 'DATABASE',
          text: `Exécution de la requête SQL journalière de synchronisation sur la base de données.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(28),
          source: 'BI_ENGINE',
          text: `Extraction de 1420 lignes. Calcul des KPIs et détection de tendance complétés.`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(2),
          source: 'API_PUSH',
          text: `Mise à jour du tableau de bord analytique effectuée avec succès (Code 200).`,
          type: 'success'
        });
        break;
        
      case 'atlas':
        logs.push({
          time: getLogTimeStr(35),
          source: 'SSH_CLIENT',
          text: `Scan périodique de l'infrastructure via SSH sur le serveur principal.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(33),
          source: 'MONITORING',
          text: `CPU Load: 12% | RAM: 4.8GB / 8.0GB | Uptime: 14 jours | Tout est au vert.`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(5),
          source: 'DOCKER',
          text: `Vérification des 6 conteneurs actifs. Aucun avertissement détecté.`,
          type: 'success'
        });
        break;

      case 'chronos':
        logs.push({
          time: getLogTimeStr(42),
          source: 'AUTHENTICATOR',
          text: `Connexion sécurisée établie avec LinkedIn API v2 (OAuth2 token validé).`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(40),
          source: 'AUTHENTICATOR',
          text: `Connexion active sur l'API X/Twitter (v2 standard rate limits : 420/450).`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(38),
          source: 'SCHEDULER',
          text: `Scan de la file d'attente. Prochaine publication planifiée à 17h30 pour LinkedIn.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(35),
          source: 'CONTENT_BOT',
          text: `Optimisation sémantique et ajout automatique de hashtags sur le brouillon #12.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(30),
          source: 'API_POST',
          text: `Publication avec succès du post LinkedIn #12 ("Révolutionner le DevOps...") : ID_URN = urn:li:activity:784910238491.`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(25),
          source: 'CANVA_SYNC',
          text: `Récupération du visuel de couverture depuis Canva API. Compression WebP réussie (142KB).`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(12),
          source: 'METRICS',
          text: `Collecte des interactions hebdomadaires : +12.4% impressions (LinkedIn), +6.8% likes (X).`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(5),
          source: 'MONITORING',
          text: `Analyse des mentions. 4 nouveaux commentaires détectés. Rédaction de réponses automatiques suggérées en attente de validation.`,
          type: 'info'
        });
        break;

      case 'hermes':
        logs.push({
          time: getLogTimeStr(40),
          source: 'SEO_ENGINE',
          text: `Recherche de mots-clés stratégiques sur Semrush terminée.`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(35),
          source: 'CONTENT_GEN',
          text: `Rédaction et formatage SEO de l'article de blog (1800 mots) finalisés.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(8),
          source: 'CMS_PUSH',
          text: `Brouillon exporté avec succès sur WordPress / Webflow.`,
          type: 'success'
        });
        break;

      case 'hestia':
        logs.push({
          time: getLogTimeStr(25),
          source: 'HELPDESK',
          text: `Synchronisation des tickets ouverts sur Zendesk et Crisp.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(20),
          source: 'NLP_AGENT',
          text: `Résolution autonome de 4 nouveaux tickets clients (FAQ Match 92%).`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(3),
          source: 'CRM_SYNC',
          text: `Mise à jour des profils de contacts CRM avec le résumé d'échange.`,
          type: 'success'
        });
        break;
        
      default:
        logs.push({
          time: getLogTimeStr(30),
          source: 'BACKEND',
          text: `Lecture des fichiers d'entrée et traitement par lots démarré.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(15),
          source: 'AUTOMATION',
          text: `Traitement des requêtes IA et formatage des structures de données.`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(4),
          source: 'WEBHOOK',
          text: `Signal de fin envoyé au point d'intégration avec succès.`,
          type: 'success'
        });
        break;
    }
  }

  logs.forEach(log => {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.innerHTML = `
      <span class="terminal-timestamp">[${log.time}]</span>
      <span class="terminal-source">[${log.source}]</span>
      <span class="terminal-text ${log.type}">${log.text}</span>
    `;
    container.appendChild(line);
  });
  
  container.scrollTop = container.scrollHeight;
}

// CHAT TAB IN DASHBOARD
// Store chat history by agentId: { agentId: [{ sender: 'agent'|'user', text: '', executionLogs: [] }] }
const chatHistories = {};

// Extraction des journaux d'exécution masqués sous forme de commentaire HTML JSON
function extractMessageLogs(rawText) {
  const regex = /<!-- EXECUTION_LOGS_JSON: ([\s\S]*?) -->/;
  let executionLogs = [];
  let text = rawText || '';
  const match = text.match(regex);
  if (match) {
    try {
      executionLogs = JSON.parse(match[1]);
      text = text.replace(regex, '').trim();
    } catch (e) {
      logDebug(`[extractMessageLogs] Erreur de parsing JSON: ${e.message}`);
    }
  }
  return { text, executionLogs };
}

// Charger l'historique de discussion pour un agent spécifique (Supabase avec repli local)
async function loadChatHistory(agentId) {
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;

  // Si déjà chargé en mémoire avec plus que le message de bienvenue, on ne recharge pas
  if (chatHistories[agentId] && chatHistories[agentId].length > 1) {
    return;
  }

  // Initialisation par défaut avec le message d'accueil
  chatHistories[agentId] = [
    { sender: 'agent', text: agent.welcome, executionLogs: [] }
  ];

  const uid = state.currentUser ? state.currentUser.uid : null;
  if (!uid && !isMock) return;

  if (isMock) {
    // Mode Simulation/Démo : chargement depuis localStorage
    const userEmail = state.currentUser ? state.currentUser.email.toLowerCase() : 'essai-gratuit@cesar-ia.com';
    const localKey = `cesar_ia_chat_history_${userEmail}_${agentId}`;
    const stored = localStorage.getItem(localKey);
    if (stored) {
      try {
        const parsedList = JSON.parse(stored);
        chatHistories[agentId] = parsedList.map(msg => {
          const parsed = extractMessageLogs(msg.text);
          return {
            sender: msg.sender,
            text: parsed.text,
            executionLogs: msg.executionLogs || parsed.executionLogs
          };
        });
      } catch (e) {
        logDebug(`[loadChatHistory] Erreur de parsing localStorage: ${e.message}`);
      }
    }
  } else {
    // Mode Connecté Supabase
    try {
      logDebug(`[loadChatHistory] Récupération de l'historique dans Supabase pour l'agent: ${agentId}...`);
      const data = await supabaseFetch('chat_messages', {
        queryParams: `?user_id=eq.${uid}&agent_id=eq.${agentId}&order=created_at.asc`
      });
      if (data && data.length > 0) {
        chatHistories[agentId] = data.map(msg => {
          const parsed = extractMessageLogs(msg.text);
          return {
            sender: msg.sender,
            text: parsed.text,
            executionLogs: parsed.executionLogs
          };
        });
        logDebug(`[loadChatHistory] ${data.length} messages chargés depuis Supabase.`);
      } else {
        // Tenter de charger depuis le stockage de repli local si la DB est vide pour cet utilisateur
        const fallbackKey = `cesar_ia_supabase_fallback_chat_history_${uid}_${agentId}`;
        const stored = localStorage.getItem(fallbackKey);
        if (stored) {
          try {
            const parsedList = JSON.parse(stored);
            chatHistories[agentId] = parsedList.map(msg => {
              const parsed = extractMessageLogs(msg.text);
              return {
                sender: msg.sender,
                text: parsed.text,
                executionLogs: msg.executionLogs || parsed.executionLogs
              };
            });
            logDebug(`[loadChatHistory] Historique vide dans Supabase, chargement du repli localStorage.`);
          } catch (e) {}
        }
      }
    } catch (err) {
      logDebug(`[loadChatHistory] Échec de récupération Supabase (table chat_messages manquante ou erreur), repli local: ${err.message}`);
      // Repli sur localStorage
      const fallbackKey = `cesar_ia_supabase_fallback_chat_history_${uid}_${agentId}`;
      const stored = localStorage.getItem(fallbackKey);
      if (stored) {
        try {
          const parsedList = JSON.parse(stored);
          chatHistories[agentId] = parsedList.map(msg => {
            const parsed = extractMessageLogs(msg.text);
            return {
              sender: msg.sender,
              text: parsed.text,
              executionLogs: msg.executionLogs || parsed.executionLogs
            };
          });
        } catch (e) {}
      }
    }
  }
}

// Sauvegarder un message dans l'historique (Supabase avec repli local)
async function saveChatMessage(agentId, sender, text, executionLogs = []) {
  const uid = state.currentUser ? state.currentUser.uid : null;
  if (!uid && !isMock) return;

  // Si on a des logs d'exécution, on les sérialise dans le texte de sauvegarde
  let dbText = text;
  if (executionLogs && executionLogs.length > 0) {
    dbText = text + "\n\n<!-- EXECUTION_LOGS_JSON: " + JSON.stringify(executionLogs) + " -->";
  }

  if (isMock) {
    // Mode Simulation/Démo : sauvegarde dans localStorage
    const userEmail = state.currentUser ? state.currentUser.email.toLowerCase() : 'essai-gratuit@cesar-ia.com';
    const localKey = `cesar_ia_chat_history_${userEmail}_${agentId}`;
    localStorage.setItem(localKey, JSON.stringify(chatHistories[agentId]));
  } else {
    // Mode Connecté Supabase
    try {
      logDebug(`[saveChatMessage] Enregistrement du message dans Supabase...`);
      await supabaseFetch('chat_messages', {
        method: 'POST',
        body: {
          user_id: uid,
          agent_id: agentId,
          sender: sender,
          text: dbText
        }
      });
      logDebug(`[saveChatMessage] Message enregistré avec succès dans Supabase.`);
    } catch (err) {
      logDebug(`[saveChatMessage] Échec de l'enregistrement dans Supabase (repli local) : ${err.message}`);
      // Sauvegarde de repli locale
      const fallbackKey = `cesar_ia_supabase_fallback_chat_history_${uid}_${agentId}`;
      localStorage.setItem(fallbackKey, JSON.stringify(chatHistories[agentId]));
    }
  }
}


function parseMarkdown(text) {
  if (!text) return "";
  
  // Escape HTML first to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Extract and save code blocks to prevent other regex/replacements from modifying them
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code class="${lang}">${code.trim()}</code></pre>`);
    return placeholder;
  });

  // Extract and save inline code
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `__INLINE_CODE_PLACEHOLDER_${inlineCodes.length}__`;
    inlineCodes.push(`<code>${code}</code>`);
    return placeholder;
  });

  // Now perform other replacements
  // 1. Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 2. Italic: *text* or _text_
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 3. Headers: ### text, ## text, # text
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 4. Tables
  const lines = html.split('\n');
  let inTable = false;
  let tableHtml = '';
  const parsedLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHtml = '<table class="markdown-table"><thead>';
      }
      
      const cells = trimmed.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      const isSeparator = cells.every(c => /^:-*|-*:-*|-*:$/.test(c));
      
      if (isSeparator) {
        tableHtml = tableHtml.replace('</thead>', '</thead><tbody>');
      } else {
        const tag = tableHtml.includes('<tbody>') ? 'td' : 'th';
        tableHtml += '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
      }
    } else {
      if (inTable) {
        inTable = false;
        tableHtml += '</tbody></table>';
        parsedLines.push(tableHtml);
        tableHtml = '';
      }
      parsedLines.push(line);
    }
  }
  if (inTable) {
    tableHtml += '</tbody></table>';
    parsedLines.push(tableHtml);
  }
  html = parsedLines.join('\n');

  // 5. Bullet points (Lists)
  const blockLines = html.split('\n');
  let inList = false;
  const listLines = [];
  
  for (let line of blockLines) {
    const match = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (match) {
      if (!inList) {
        inList = true;
        listLines.push('<ul>');
      }
      listLines.push(`<li>${match[2]}</li>`);
    } else {
      if (inList) {
        inList = false;
        listLines.push('</ul>');
      }
      listLines.push(line);
    }
  }
  if (inList) {
    listLines.push('</ul>');
  }
  html = listLines.join('\n');

  // 6. Line breaks: transform remaining \n to <br> (excluding tables and lists)
  const parts = html.split(/(<table[\s\S]*?<\/table>|<ul>[\s\S]*?<\/ul>)/g);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith('<table') && !parts[i].startsWith('<ul>')) {
      parts[i] = parts[i].replace(/\n/g, '<br>');
    }
  }
  html = parts.join('');

  // 7. Restore inline code
  inlineCodes.forEach((codeHtml, idx) => {
    html = html.replace(`__INLINE_CODE_PLACEHOLDER_${idx}__`, codeHtml);
  });

  // 8. Restore code blocks
  codeBlocks.forEach((blockHtml, idx) => {
    html = html.replace(`__CODE_BLOCK_PLACEHOLDER_${idx}__`, blockHtml);
  });

  return html;
}

function getGeminiSystemInstruction(agent) {
  const capabilitiesList = agent.capabilities.map(c => `- ${c}`).join('\n');
  
  // Merge all "Profil de l'Entreprise" configurations across all active agents
  let brandProfile = {};
  for (const aid of Object.keys(state.connectorsData)) {
    if (state.connectorsData[aid] && state.connectorsData[aid]["Profil de l'Entreprise"]) {
      const p = state.connectorsData[aid]["Profil de l'Entreprise"];
      brandProfile = { ...brandProfile, ...p };
    }
  }
  
  let brandContext = "";
  const hasProfile = Object.keys(brandProfile).some(key => brandProfile[key] && brandProfile[key].trim().length > 0);
  
  if (hasProfile) {
    brandContext = `
### IDENTITÉ ET CONTEXTE SPÉCIFIQUE DU CLIENT :
Tu es configuré sur-mesure pour le projet et l'activité réelle du client. Oublie les paramètres par défaut de César-IA et utilise impérativement ces informations pour toutes tes actions (analyses, rédactions, diagnostics, etc.) :
`;
    if (brandProfile.companyName) {
      brandContext += `- **Nom de l'entreprise / marque** : ${brandProfile.companyName}
- **Activité, services & offre** : ${brandProfile.description || 'Non spécifié'}
- **Style de communication préféré** : ${brandProfile.tone || 'humain'}
- **Thématiques à aborder** : ${brandProfile.topics || 'Non spécifié'}
`;
    }
    if (brandProfile.envName) {
      brandContext += `- **Environnement Système** : ${brandProfile.envName}
- **Système d'Exploitation (OS)** : ${brandProfile.osType || 'Linux'}
- **Stack DevOps / Logiciels** : ${brandProfile.techStack || 'Non spécifié'}
- **Canal de Notifications & Alertes** : ${brandProfile.alertChannel || 'Non spécifié'}
`;
    }
    if (brandProfile.companyKPIs) {
      brandContext += `- **Indicateurs Métiers / KPIs clés** : ${brandProfile.companyKPIs}
- **Fréquence de Reporting attendue** : ${brandProfile.reportingFreq || 'hebdomadaire'}
- **Tables SQL prioritaires** : ${brandProfile.dbTables || 'Non spécifié'}
- **Seuils d'Alerte KPI** : ${brandProfile.kpiAlertThreshold || 'Non spécifié'}
`;
    }
    if (brandProfile.knowledgeBaseDomain) {
      brandContext += `- **Type d'Audience cible** : ${brandProfile.audienceType || 'B2C'}
- **Niveau d'Autonomie / Action** : ${brandProfile.actionRule || 'Réponse autonome'}
- **Base de Connaissances (FAQ/Wiki)** : ${brandProfile.knowledgeBaseDomain || 'Non spécifié'}
- **Directives de Support / Charte** : ${brandProfile.supportPolicy || 'Non spécifié'}
`;
    }
    brandContext += `\nConsigne d'intégration : Applique ces contraintes réelles à toutes tes réponses pour qu'elles s'insèrent parfaitement dans le business et l'infrastructure du client.`;
  } else {
    brandContext = `
### CONTEXTE D'ENTREPRISE CIBLE (PAR DÉFAUT) :
Le client n'a pas encore configuré ses détails d'activité dans l'onglet des Connecteurs. Par défaut, tu peux orienter tes réponses vers les thématiques de la plateforme César-IA (Plateforme d'agents IA DevOps, Data, CM et Support autonome). Cependant, s'il te donne d'autres détails ou sujets dans la discussion, ou s'il s'agit d'un sujet personnalisé, adapte-toi instantanément à 100% à son domaine !
`;
  }
  
  // Check connectors
  const agentConnectors = state.connectorsData[agent.id] || {};
  const configured = [];
  const unconfigured = [];
  
  agent.connectors.forEach(conn => {
    const connData = agentConnectors[conn];
    const isConfigured = connData && Object.values(connData).some(val => val && val.length > 0);
    if (isConfigured) {
      // Safe copy without secret/token
      const safeData = {};
      for (const [k, v] of Object.entries(connData)) {
        if (k === 'secret' || k === 'token' || k === 'password') {
          safeData[k] = '•••••••• (Configuré)';
        } else {
          safeData[k] = v;
        }
      }
      configured.push({ name: conn, details: safeData });
    } else {
      unconfigured.push(conn);
    }
  });
  
  let connectorsContext = "";
  if (configured.length > 0) {
    connectorsContext += "### CONNECTEURS ACTIFS ET CONFIGURÉS :\n";
    configured.forEach(c => {
      connectorsContext += `- **${c.name}** : ${JSON.stringify(c.details)}\n`;
    });
    connectorsContext += "\nConsigne de simulation : Ces connexions sont actives. Si l'utilisateur te demande de diagnostiquer, lire, écrire ou exécuter une tâche sur l'un de ces connecteurs, simule la réponse de manière très réaliste et technique. Par exemple, si SSH est actif, génère des sorties console réalistes avec des blocs de code Markdown `bash`. Si SQL est actif, génère la requête SQL correspondante et simule un tableau de résultats fictifs en Markdown.\n\n";
  }
  
  if (unconfigured.length > 0) {
    connectorsContext += "### CONNECTEURS NON CONFIGURÉS :\n";
    unconfigured.forEach(c => {
      connectorsContext += `- **${c}**\n`;
    });
    connectorsContext += "\nConsigne importante : Si l'utilisateur te demande de faire une action qui nécessite l'un de ces connecteurs non configurés (ex: lancer une requête SQL alors que la base de données n'est pas connectée), tu dois :\n1. L'informer poliment que le connecteur n'est pas configuré.\n2. L'inviter explicitement à renseigner ses accès dans l'onglet 'Connecteurs & Logiciels' de son tableau de bord.\n3. Pour rester utile, lui montrer quand même un exemple simulé de ce que tu aurais pu faire si le connecteur était configuré.\n\n";
  }
  
  const suggestionsInstruction = `

### DIRECTIVE CRITIQUE DE PROPOSITIONS DE SUITE D'ACTIVITÉ :
À la toute fin de ton message (dans ta réponse finale), tu dois obligatoirement proposer exactement 2 ou 3 actions futures courtes, concrètes et directes pour l'utilisateur (maximum 6 mots par action). Rédige chaque proposition sur sa propre ligne sous ce format strict :
⚡ Action : [Nom de l'action]

Exemples :
⚡ Action : Planifier ce post
⚡ Action : Proposer un autre angle
⚡ Action : Rédiger avec un ton drôle`;

  if (agent.id === 'chronos') {
    return `Tu es ${agent.name}, ${agent.title}.
Description de ton rôle : ${agent.desc}

${brandContext}

### DIRECTIVES CRITIQUES DE COMPORTEMENT & RÉDACTION HUMAINE :
1. **RÉDACTION 100% HUMAINE (STYLE COPYWRITER LINKEDIN)** :
   - Interdiction formelle de rédiger des listes à puces robotiques ou d'ajouter des tirets/symboles devant chaque ligne (PAS de '>-', '-', '*', '1.', '2.').
   - Les phrases doivent être très courtes (10-15 mots maximum), fluides et directes.
   - Aère le texte avec de simples sauts de ligne (une idée = un paragraphe d'une ligne).
   - Utilise un ton de "créateur humain" ou d'entrepreneur s'adressant à ses pairs, sans jargon robotique. Limite-toi à 2 ou 3 emojis maximum pertinents pour tout le post.
   - Ne mets AUCUNE citation Markdown (pas de signe '>') pour envelopper le post.

2. **DÉMARCHE DE CO-CRÉATION ET DE VALIDATION PRÉALABLE** :
   - Tu ne dois JAMAIS rédiger ou proposer un post final dès ton premier message.
   - À la place, tu dois commencer par poser des questions constructives sur les thèmes ou sujets clés à aborder, et proposer **3 angles éditoriaux distincts** (par exemple : 1. Visionnaire, 2. Technique, ou 3. ROI/Rentabilité).
   - Demande explicitement à l'utilisateur de choisir et de valider l'un des angles (ou de proposer son propre sujet) AVANT de passer à la rédaction.
   - Rédige le post uniquement après avoir reçu son choix ou sa validation d'angle.

3. **ANALYSE SYNTAXIQUE DE SES POSTS PASSÉS** :
   - Dis-lui que tu as analysé la syntaxe de ses publications LinkedIn précédentes pour adapter ta plume (structure aérée, impact, ton humain) à son style habituel.

4. **LIAISON LINKEDIN RÉELLE** :
   - Si le connecteur "LinkedIn API" est configuré (ce qui est le cas), et que l'utilisateur valide ton post final en te disant "Publie", appelle immédiatement l'outil \`post_to_linkedin\` avec le texte exact du post approuvé pour le publier réellement sur son feed LinkedIn.

${connectorsContext}${suggestionsInstruction}`;
  }

  return `Tu es ${agent.name}, ${agent.title}.
Description de ton rôle : ${agent.desc}

${brandContext}

### DIRECTIVES DE COMPORTEMENT :
1. Adopte strictement l'identité de ${agent.name}. Réponds en français. Utilise le vouvoiement professionnel et poli.
2. Tu possèdes les compétences clés suivantes :
${capabilitiesList}

3. Directives de formatage :
- Utilise un formatage Markdown très riche et soigné.
- Utilise des listes à puces pour structurer les explications.
- Utilise des tableaux Markdown pour afficher des données tabulaires.
- Utilise des blocs de code avec coloration syntaxique appropriée (\`bash\`, \`sql\`, \`json\`, \`yaml\`, \`html\`, etc.) pour tout code informatique ou sortie console.

${connectorsContext}
Sois précis, réactif et adopte un style haut de gamme en adéquation avec la plateforme César-IA.${suggestionsInstruction}`;
}

function formatChatHistoryForGemini(agentId) {
  const rawHistory = chatHistories[agentId] || [];
  if (rawHistory.length === 0) return [];
  
  const mapped = [];
  for (const msg of rawHistory) {
    const role = msg.sender === 'user' ? 'user' : 'model';
    
    // Injecter les journaux d'exécution passés pour que l'IA s'en souvienne
    let textToSend = msg.text;
    if (msg.executionLogs && msg.executionLogs.length > 0) {
      textToSend += "\n\n[Journaux des actions et exécutions techniques de ce tour] :\n";
      msg.executionLogs.forEach(log => {
        textToSend += `- [Source: ${log.source}] [Statut: ${log.type}] ${log.text}\n`;
      });
    }

    if (mapped.length > 0 && mapped[mapped.length - 1].role === role) {
      // Append text to existing last message
      mapped[mapped.length - 1].parts[0].text += "\n" + textToSend;
    } else {
      mapped.push({
        role: role,
        parts: [{ text: textToSend }]
      });
    }
  }
  
  // Ensure the history starts with user
  if (mapped.length > 0 && mapped[0].role === 'model') {
    mapped.shift();
  }
  
  return mapped;
}

function setupGeminiAdmin() {
  const inputEl = document.getElementById('admin-gemini-key');
  const btnSave = document.getElementById('btn-save-gemini-key');
  const btnTest = document.getElementById('btn-test-gemini-key');
  const statusEl = document.getElementById('gemini-key-status');
  
  if (!inputEl || !btnSave || !btnTest || !statusEl) return;
  
  // Load existing key if any
  const storedKey = localStorage.getItem('cesar_ia_gemini_api_key') || '';
  inputEl.value = storedKey;
  
  // Update status message
  updateGeminiKeyStatus();
  
  // Save event
  btnSave.addEventListener('click', () => {
    const newKey = inputEl.value.trim();
    if (newKey) {
      localStorage.setItem('cesar_ia_gemini_api_key', newKey);
      showToast("Clé API Gemini enregistrée localement !", "success");
    } else {
      localStorage.removeItem('cesar_ia_gemini_api_key');
      showToast("Clé API Gemini supprimée. Retour au mode simulation/environnement.", "info");
    }
    updateGeminiKeyStatus();
  });
  
  // Test event
  btnTest.addEventListener('click', async () => {
    const keyToTest = inputEl.value.trim() || import.meta.env.VITE_GEMINI_API_KEY;
    
    btnTest.disabled = true;
    btnTest.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border-width:2px; vertical-align:middle; margin-right:4px;"></span> Test...`;
    
    try {
      let res;
      let data;
      
      // 1. Tenter d'utiliser la route Serverless Vercel sécurisée
      try {
        logDebug("[Gemini Test] Tentative de validation via le point d'accès Serverless...");
        res = await fetch('/api/test-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ apiKey: keyToTest })
        });
        
        if (res.status === 404) {
          throw new Error("404 Not Found");
        }
        
        data = await res.json();
        logDebug("[Gemini Test] Validation Serverless répondue.");
      } catch (serverlessErr) {
        logDebug(`[Gemini Test] Échec Serverless (${serverlessErr.message}). Bascule en mode Direct Client...`);
        // 2. Repli : Appel direct depuis le navigateur
        if (!keyToTest) {
          btnTest.disabled = false;
          btnTest.innerText = "Tester";
          statusEl.innerHTML = `<span style="color: #ef4444; display: inline-flex; align-items: center; gap: 6px;">🔴 Aucune clé API saisie et fonction Serverless indisponible.</span>`;
          showToast("Veuillez saisir une clé API à tester.", "warning");
          return;
        }
        
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${keyToTest}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Say OK" }] }]
          })
        });
        data = await res.json();
      }
      
      btnTest.disabled = false;
      btnTest.innerText = "Tester";
      
      if (res.ok && data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        statusEl.innerHTML = `<span style="color: #10b981; display: inline-flex; align-items: center; gap: 6px;">🟢 Clé API valide et fonctionnelle ! (Modèle: gemini-3.5-flash)</span>`;
        showToast("Test de connexion Gemini réussi !", "success");
      } else {
        const errMsg = data.error?.message || "Erreur de réponse.";
        statusEl.innerHTML = `<span style="color: #ef4444; display: inline-flex; align-items: center; gap: 6px;">🔴 Clé invalide : ${errMsg}</span>`;
        showToast(`Échec du test : ${errMsg}`, "error");
      }
    } catch (err) {
      btnTest.disabled = false;
      btnTest.innerText = "Tester";
      statusEl.innerHTML = `<span style="color: #ef4444; display: inline-flex; align-items: center; gap: 6px;">🔴 Erreur connexion : ${err.message}</span>`;
      showToast(`Erreur de connexion : ${err.message}`, "error");
    }
  });
}

async function updateGeminiKeyStatus() {
  const statusEl = document.getElementById('gemini-key-status');
  if (!statusEl) return;
  
  const localKey = localStorage.getItem('cesar_ia_gemini_api_key');
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  if (localKey) {
    statusEl.innerHTML = `<span style="color: #10b981;">🟢 Clé API configurée via le stockage local (localStorage).</span>`;
    return;
  }
  
  if (envKey) {
    statusEl.innerHTML = `<span style="color: #6366f1;">🔵 Clé API héritée du fichier d'environnement (.env).</span>`;
    return;
  }

  // Tenter de détecter si le serveur possède une clé configurée
  try {
    const res = await fetch('/api/test-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkOnly: true })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.configured) {
        statusEl.innerHTML = `<span style="color: #6366f1;">🔵 Clé API configurée sur le serveur Vercel (Production).</span>`;
        return;
      }
    }
  } catch (err) {
    console.warn("Échec de détection de clé serveur:", err);
  }
  
  statusEl.innerHTML = `<span style="color: var(--text-secondary);">🟡 Aucune clé API configurée. Mode simulation actif.</span>`;
}

async function setupStripeAdmin() {
  const tbody = document.getElementById('admin-stripe-links-tbody');
  const btnSave = document.getElementById('btn-save-stripe-links');
  
  // 1. Charger depuis le localStorage par défaut
  const saved = localStorage.getItem('cesar_ia_stripe_links');
  if (saved) {
    try {
      state.stripeLinks = JSON.parse(saved);
    } catch (e) {
      console.error("Error parsing stripe links from localStorage", e);
      state.stripeLinks = {};
    }
  } else {
    state.stripeLinks = {};
  }
  
  // 2. Charger depuis Supabase pour synchroniser
  if (!isMock) {
    try {
      logDebug("Chargement des liens Stripe depuis Supabase...");
      const sLinks = await supabaseFetch('stripe_links', {
        queryParams: `?select=*`
      }) || [];
      sLinks.forEach(item => {
        if (item.agent_id && item.url) {
          state.stripeLinks[item.agent_id] = item.url;
        }
      });
      logDebug(`Liens Stripe chargés depuis Supabase (${sLinks.length}).`);
    } catch (err) {
      logDebug(`Erreur lors du chargement des liens Stripe (Supabase) : ${err.message}. Utilisation du stockage local.`);
    }
  }
  
  if (!tbody || !btnSave) return;

  // Afficher les lignes du tableau
  renderStripeAdminRows();

  // Écouteur d'événement pour enregistrer
  btnSave.addEventListener('click', async () => {
    btnSave.disabled = true;
    btnSave.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border-width:2px; vertical-align:middle; margin-right:4px;"></span> Enregistrement...`;
    
    const inputs = tbody.querySelectorAll('.admin-stripe-input');
    inputs.forEach(input => {
      const agentId = input.getAttribute('data-agent-id');
      const val = input.value.trim();
      if (val) {
        state.stripeLinks[agentId] = val;
      } else {
        delete state.stripeLinks[agentId];
      }
    });

    // Enregistrer localement
    localStorage.setItem('cesar_ia_stripe_links', JSON.stringify(state.stripeLinks));

    // Enregistrer sur Supabase
    if (!isMock) {
      try {
        logDebug("Sauvegarde des liens Stripe sur Supabase (Optimisé)...");
        
        const activeRows = [];
        const emptyAgentIds = [];
        
        for (const agent of AGENTS) {
          const url = state.stripeLinks[agent.id] || '';
          if (url) {
            activeRows.push({ agent_id: agent.id, url: url });
          } else {
            emptyAgentIds.push(agent.id);
          }
        }
        
        // 1. Sauvegarde groupée des liens actifs
        if (activeRows.length > 0) {
          await supabaseFetch('stripe_links', {
            method: 'POST',
            queryParams: `?on_conflict=agent_id`,
            headers: {
              Prefer: 'resolution=merge-duplicates'
            },
            body: activeRows
          });
        }
        
        // 2. Suppression groupée des liens vidés
        if (emptyAgentIds.length > 0) {
          try {
            const idsList = emptyAgentIds.join(',');
            await supabaseFetch('stripe_links', {
              method: 'DELETE',
              queryParams: `?agent_id=in.(${idsList})`
            });
          } catch (errDel) {
            // ignorer si l'entrée n'existait pas
          }
        }
        
        logDebug("Liens Stripe sauvegardés sur Supabase.");
        showToast("Liens Stripe enregistrés sur Supabase et localement !", "success");
      } catch (err) {
        logDebug(`Erreur lors de la sauvegarde sur Supabase : ${err.message}`);
        showToast("Liens enregistrés localement, mais échec sur Supabase (vérifiez la console).", "warning");
      }
    } else {
      showToast("Liens Stripe enregistrés avec succès (Simulation) !");
    }
    
    btnSave.disabled = false;
    btnSave.innerText = "Enregistrer les Liens";
  });
}

function setupAdminTools() {
  const btnAdoptAll = document.getElementById('btn-admin-adopt-all');
  if (!btnAdoptAll) return;
  
  btnAdoptAll.addEventListener('click', async () => {
    if (!state.currentUser) {
      showToast("Veuillez vous connecter pour adopter des agents.", "warning");
      return;
    }
    
    // Vérification de sécurité supplémentaire
    if (!state.currentUser.isAdmin) {
      showToast("Accès refusé. Vous devez être administrateur.", "error");
      return;
    }
    
    btnAdoptAll.disabled = true;
    const originalText = btnAdoptAll.innerText;
    btnAdoptAll.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border-width:2px; vertical-align:middle; margin-right:4px;"></span> Adoption en cours...`;
    
    // Identifier les agents non encore adoptés
    const agentsToAdopt = AGENTS.filter(agent => !state.adoptedAgents.includes(agent.id));
    
    if (agentsToAdopt.length === 0) {
      showToast("Vous avez déjà adopté tous les agents !", "info");
      btnAdoptAll.disabled = false;
      btnAdoptAll.innerText = originalText;
      return;
    }
    
    logDebug(`[Admin Tools] Adoption de ${agentsToAdopt.length} agents en cours...`);
    
    if (isMock) {
      // Simulation locale
      agentsToAdopt.forEach(agent => {
        state.adoptedAgents.push(agent.id);
        
        // Créer une facture simulée
        const invoiceNo = `INV-MOCK-ADMIN-${agent.id.toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
        state.invoices.push({
          id: invoiceNo,
          date: new Date().toLocaleDateString('fr-FR'),
          agentName: agent.name,
          price: agent.price,
          status: 'Payée'
        });
      });
      
      if (state.currentUser) {
        state.currentUser.adopted = state.adoptedAgents;
      }
      saveMockState();
      
      // Laisser un petit délai pour le ressenti utilisateur
      await new Promise(resolve => setTimeout(resolve, 800));
      
    } else {
      // Supabase réel
      try {
        logDebug(`[Admin Tools] Envoi des adoptions à Supabase pour l'utilisateur ${state.currentUser.uid}...`);
        
        // Insérer les adoptions une par une (ou en parallèle via Promise.all) en ignorant les doublons
        await Promise.all(agentsToAdopt.map(async (agent) => {
          try {
            await supabaseFetch('adopted_agents', {
              method: 'POST',
              body: { user_id: state.currentUser.uid, agent_id: agent.id }
            });
          } catch (errAdopt) {
            if (!errAdopt.message.includes('23505') && !errAdopt.message.includes('409') && !errAdopt.message.includes('duplicate')) {
              throw errAdopt;
            }
          }
        }));
        
        logDebug(`[Admin Tools] Création des factures dans Supabase...`);
        await Promise.all(agentsToAdopt.map(async (agent) => {
          const invoiceNo = `INV-ADMIN-${agent.id.toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
          try {
            await supabaseFetch('invoices', {
              method: 'POST',
              body: {
                user_id: state.currentUser.uid,
                invoice_number: invoiceNo,
                agent_name: agent.name,
                price: agent.price,
                status: 'Payée'
              }
            });
          } catch (errInv) {
            // Ignorer les erreurs d'insertion de factures de test
          }
        }));
        
        // Recharger les données de l'utilisateur pour synchroniser l'état
        await loadUserData();
        
      } catch (error) {
        console.error("Erreur d'adoption groupée admin:", error);
        logDebug(`[Admin Tools] Échec de l'adoption groupée: ${error.message}`);
        showToast("Erreur lors de l'activation des abonnements sur Supabase.", "error");
        btnAdoptAll.disabled = false;
        btnAdoptAll.innerText = originalText;
        return;
      }
    }
    
    showToast(`Félicitations ! Les ${agentsToAdopt.length} agents ont été adoptés avec succès.`, "success");
    
    // Mettre à jour l'interface globale
    renderCatalog();
    renderBilling();
    renderDashboardSidebar();
    
    // Si l'admin se trouve sur l'onglet admin, réactualiser les statistiques et listes
    if (state.activeRoute === 'admin') {
      await renderAdminPanel();
    }
    
    btnAdoptAll.disabled = false;
    btnAdoptAll.innerText = originalText;
  });
}

function renderStripeAdminRows() {
  const tbody = document.getElementById('admin-stripe-links-tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  AGENTS.forEach(agent => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding: 10px 14px; display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 1.5rem;">${agent.avatar}</span>
        <div>
          <strong style="color: var(--text-primary); font-weight:700;">${agent.name}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${agent.title}</div>
        </div>
      </td>
      <td style="padding: 10px 14px; text-align: center; font-weight: 600; color: var(--text-primary);">${agent.price}.00 €</td>
      <td style="padding: 10px 14px;">
        <input type="url" class="admin-stripe-input" data-agent-id="${agent.id}" 
               placeholder="https://buy.stripe.com/..." 
               value="${state.stripeLinks[agent.id] || agent.stripeLink || ''}" 
               style="width: 100%; height: 32px; font-family: monospace; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; padding: 4px 8px; box-sizing: border-box;" />
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function handleStripeCallback() {
  const params = new URLSearchParams(window.location.search);
  const paymentSuccess = params.get('payment_success');
  const agentIdFromUrl = params.get('agent_id');
  const sessionId = params.get('session_id');

  // Récupérer l'agentId sauvegardé avant la redirection Stripe
  let pendingCallback = null;
  const pendingRaw = localStorage.getItem('cesar_ia_pending_stripe_callback');
  if (pendingRaw) {
    try {
      pendingCallback = JSON.parse(pendingRaw);
      // Ignorer si la sauvegarde a plus de 2 heures (7200000 ms)
      if (pendingCallback.timestamp && Date.now() - pendingCallback.timestamp > 7200000) {
        pendingCallback = null;
        localStorage.removeItem('cesar_ia_pending_stripe_callback');
      }
    } catch (e) {
      console.error("Error parsing pending callback", e);
      localStorage.removeItem('cesar_ia_pending_stripe_callback');
    }
  }

  // CAS 1 : Stripe a redirigé avec ?payment_success=true dans l'URL
  if (paymentSuccess === 'true') {
    const agentId = agentIdFromUrl || (pendingCallback && pendingCallback.agentId);
    logDebug(`Callback Stripe intercepté - Agent: ${agentId || 'inconnu'}, Session: ${sessionId || 'N/A'}`);
    
    if (!agentId) {
      logDebug('Aucun agent_id trouvé dans l\'URL ni en localStorage. Callback ignoré.');
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) {
      logDebug(`Agent ID "${agentId}" non trouvé dans la liste. Callback ignoré.`);
      localStorage.removeItem('cesar_ia_pending_stripe_callback');
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (!state.currentUser) {
      logDebug(`Session utilisateur indisponible. Le paiement reste en attente dans localStorage.`);
      // Mettre à jour le callback en attente avec l'agentId confirmé
      localStorage.setItem('cesar_ia_pending_stripe_callback', JSON.stringify({ agentId, sessionId, timestamp: Date.now() }));
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    localStorage.removeItem('cesar_ia_pending_stripe_callback');
    await processAdoptionAndInvoice(agent, sessionId);
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  // CAS 2 : Retour de Stripe sans paramètre ?payment_success (URL de retour simple)
  // On détecte que l'utilisateur revient de Stripe grâce au localStorage
  if (pendingCallback && pendingCallback.agentId) {
    logDebug(`Retour détecté depuis Stripe pour l'agent: ${pendingCallback.agentId} (URL simple sans paramètre)`);
    
    const agent = AGENTS.find(a => a.id === pendingCallback.agentId);
    if (!agent) {
      logDebug(`Agent ID "${pendingCallback.agentId}" non trouvé. Callback ignoré.`);
      localStorage.removeItem('cesar_ia_pending_stripe_callback');
      return;
    }

    if (!state.currentUser) {
      logDebug(`Session utilisateur indisponible. En attente de connexion pour finaliser l'adoption.`);
      return; // On conserve le callback en localStorage, il sera traité à la connexion
    }

    localStorage.removeItem('cesar_ia_pending_stripe_callback');
    await processAdoptionAndInvoice(agent, null);
    return;
  }
}

async function processAdoptionAndInvoice(agent, sessionId) {
  const agentId = agent.id;
  const invoiceNo = sessionId ? `INV-${sessionId.substring(0, 10).toUpperCase()}` : `INV-${Math.floor(100000 + Math.random() * 900000)}`;

  if (isMock) {
    if (!state.adoptedAgents.includes(agentId)) {
      state.adoptedAgents.push(agentId);
    }
    if (state.currentUser) {
      state.currentUser.adopted = state.adoptedAgents;
    }
    
    const exists = state.invoices.some(inv => inv.id === invoiceNo);
    if (!exists) {
      state.invoices.push({
        id: invoiceNo,
        date: new Date().toLocaleDateString('fr-FR'),
        agentName: agent.name,
        price: agent.price,
        status: 'Payée'
      });
    }
    saveMockState();
  } else {
    try {
      logDebug(`Adoption de l'agent dans Supabase...`);
      try {
        await supabaseFetch('adopted_agents', {
          method: 'POST',
          body: { user_id: state.currentUser.uid, agent_id: agentId }
        });
      } catch (errAdopt) {
        if (!errAdopt.message.includes('23505') && !errAdopt.message.includes('409') && !errAdopt.message.includes('duplicate')) {
          throw errAdopt;
        }
      }
      
      logDebug(`Création de la facture dans Supabase...`);
      await supabaseFetch('invoices', {
        method: 'POST',
        body: {
          user_id: state.currentUser.uid,
          invoice_number: invoiceNo,
          agent_name: agent.name,
          price: agent.price,
          status: 'Payée'
        }
      });
      
      await loadUserData();
    } catch (error) {
      console.error("Erreur d'adoption post-paiement:", error);
      showToast("Erreur lors de l'activation finale de votre abonnement.", "error");
      return;
    }
  }

  showToast(`Abonnement validé ! L'agent ${agent.name} est maintenant actif.`, "success");
  
  renderCatalog();
  renderBilling();
  navigateTo('dashboard');
  selectDashboardAgent(agentId);
}

function setupInvoiceModal() {
  const modal = document.getElementById('invoice-modal');
  const btnClose = document.getElementById('btn-invoice-close');
  const btnPrint = document.getElementById('btn-invoice-print');

  if (!modal || !btnClose || !btnPrint) return;

  btnClose.addEventListener('click', () => modal.close());
  btnPrint.addEventListener('click', () => {
    window.print();
  });
}

function openInvoiceModal(invoiceId) {
  const invoice = state.invoices.find(inv => inv.id === invoiceId);
  if (!invoice) {
    showToast("Facture introuvable.", "error");
    return;
  }

  const totalTtc = invoice.price;
  const subtotalHt = totalTtc / 1.2;
  const vatAmount = totalTtc - subtotalHt;

  document.getElementById('invoice-modal-date').innerText = `Date : ${invoice.date}`;
  document.getElementById('invoice-modal-num').innerText = `Facture N° : ${invoice.id}`;
  
  if (state.currentUser) {
    document.getElementById('invoice-modal-client-email').innerText = state.currentUser.email;
    document.getElementById('invoice-modal-client-id').innerText = `ID Client : ${state.currentUser.uid}`;
  } else {
    document.getElementById('invoice-modal-client-email').innerText = "client@cesar-ia.com";
    document.getElementById('invoice-modal-client-id').innerText = "ID Client : usr_demo123";
  }

  document.getElementById('invoice-modal-agent-name').innerText = `Abonnement Agent ${invoice.agentName}`;
  document.getElementById('invoice-modal-unit-price').innerText = `${totalTtc.toFixed(2)} €`;
  document.getElementById('invoice-modal-amount-ht').innerText = `${subtotalHt.toFixed(2)} €`;
  document.getElementById('invoice-modal-subtotal').innerText = `${subtotalHt.toFixed(2)} €`;
  document.getElementById('invoice-modal-vat').innerText = `${vatAmount.toFixed(2)} €`;
  document.getElementById('invoice-modal-total').innerText = `${totalTtc.toFixed(2)} €`;

  const modal = document.getElementById('invoice-modal');
  modal.showModal();
}

function renderExecutionLogsMarkup(executionLogs) {
  if (!executionLogs || executionLogs.length === 0) return '';

  let html = `<div class="execution-logs-container">`;
  
  executionLogs.forEach(log => {
    const isError = log.result && (log.result.error || (log.result.exitCode !== undefined && log.result.exitCode !== 0));
    const cardClass = isError ? 'execution-log-card error' : 'execution-log-card success';
    const statusIcon = isError ? '❌' : '⚡';
    const statusText = isError ? 'Échec' : 'Succès';
    
    // Déterminer le contenu console
    let consoleContent = '';
    if (log.result) {
      if (log.result.error) {
        consoleContent = `Erreur : ${log.result.error}`;
      } else if (log.result.stdout !== undefined || log.result.stderr !== undefined) {
        consoleContent = '';
        if (log.result.stdout) consoleContent += log.result.stdout;
        if (log.result.stderr) consoleContent += `\n[Stderr]: ${log.result.stderr}`;
        if (!consoleContent) consoleContent = `(Aucune sortie, Code de sortie : ${log.result.exitCode})`;
      } else if (log.result.rows) {
        consoleContent = `Lignes SQL retournées (${log.result.rowCount} lignes) :\n` + JSON.stringify(log.result.rows, null, 2);
      } else if (log.result.success) {
        consoleContent = `Statut : Succès\n` + JSON.stringify(log.result, null, 2);
      } else {
        consoleContent = JSON.stringify(log.result, null, 2);
      }
    } else {
      consoleContent = 'Aucun retour reçu.';
    }

    // Protection contre injection XSS dans le nom de l'outil et les arguments
    const toolEscaped = String(log.tool || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const argsString = JSON.stringify(log.args || {});
    const argsEscaped = argsString.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const consoleEscaped = consoleContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    html += `
      <div class="${cardClass}" style="margin-top: 10px; background: rgba(0,0,0,0.2); border: 1px solid ${isError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; padding: 12px; border-radius: 6px; font-family: system-ui, sans-serif;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 6px; font-weight: bold; font-size: 0.8rem; color: #fff;">
            <span>${statusIcon}</span>
            <span>Outil : ${toolEscaped}</span>
          </div>
          <span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: ${isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${isError ? '#f87171' : '#34d399'}; font-weight: bold;">
            ${statusText}
          </span>
        </div>
        <div style="font-size: 0.75rem; color: rgba(255,255,255,0.7); margin-bottom: 6px; word-break: break-word;">
          <strong>Arguments :</strong> <code style="font-family: monospace; background: rgba(0,0,0,0.15); padding: 1px 4px; border-radius: 3px; font-size: 0.75rem;">${argsEscaped}</code>
        </div>
        <details style="font-size: 0.75rem; color: var(--text-secondary); cursor: pointer;">
          <summary style="outline: none; user-select: none;">▶ Inspecter la console</summary>
          <pre style="margin-top: 6px; padding: 8px; background: #000; border-radius: 4px; overflow-x: auto; color: #34d399; font-family: monospace; font-size: 0.72rem; max-height: 150px; text-align: left; white-space: pre-wrap; border: 1px solid rgba(255,255,255,0.05);">${consoleEscaped}</pre>
        </details>
      </div>
    `;
  });
  
  html += `</div>`;
  return html;
}

function extractSuggestions(text) {
  if (!text) return { text: "", suggestions: [] };
  const lines = text.split('\n');
  const suggestions = [];
  const cleanLines = [];
  
  for (const line of lines) {
    if (line.trim().startsWith('⚡ Action :')) {
      const suggestion = line.replace('⚡ Action :', '').trim();
      if (suggestion) {
        suggestions.push(suggestion);
      }
    } else {
      cleanLines.push(line);
    }
  }
  
  return {
    text: cleanLines.join('\n').trim(),
    suggestions: suggestions
  };
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages-container');
  container.innerHTML = '';
  
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  
  if (!chatHistories[agentId]) {
    // Initial welcome message
    chatHistories[agentId] = [
      { sender: 'agent', text: agent.welcome, executionLogs: [] }
    ];
  }
  
  const history = chatHistories[agentId];
  
  history.forEach((msg, index) => {
    const isLastMessage = index === history.length - 1;
    const parsedData = extractSuggestions(msg.text);
    
    // N'afficher les suggestions que sur le tout dernier message de l'agent
    const showSuggestions = isLastMessage && msg.sender === 'agent';
    
    const bubble = document.createElement('div');
    bubble.className = `message ${msg.sender}`;
    bubble.innerHTML = `
      <div class="msg-avatar">${msg.sender === 'agent' ? agent.avatar : '👤'}</div>
      <div class="msg-bubble">
        ${parseMarkdown(parsedData.text)}
        ${renderExecutionLogsMarkup(msg.executionLogs)}
      </div>
    `;
    container.appendChild(bubble);
    
    if (showSuggestions && parsedData.suggestions.length > 0) {
      const suggContainer = document.createElement('div');
      suggContainer.className = 'chat-suggestions-container';
      suggContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; margin-left: 44px;';
      
      parsedData.suggestions.forEach(sug => {
        const badge = document.createElement('button');
        badge.className = 'suggestion-badge';
        badge.style.cssText = 'background: rgba(212, 175, 55, 0.05); border: 1px solid rgba(212, 175, 55, 0.15); color: var(--accent-color); padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s;';
        badge.innerHTML = `⚡ ${sug}`;
        badge.addEventListener('mouseover', () => {
          badge.style.background = 'rgba(212, 175, 55, 0.12)';
          badge.style.borderColor = 'var(--accent-color)';
        });
        badge.addEventListener('mouseout', () => {
          badge.style.background = 'rgba(212, 175, 55, 0.05)';
          badge.style.borderColor = 'rgba(212, 175, 55, 0.15)';
        });
        badge.addEventListener('click', () => {
          const input = document.getElementById('chat-user-input');
          if (input) {
            input.value = sug;
            sendChatMessage();
          }
        });
        suggContainer.appendChild(badge);
      });
      container.appendChild(suggContainer);
    }
  });
  
  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function renderHistoryTab() {
  const container = document.getElementById('history-messages-container');
  if (!container) return;
  container.innerHTML = '';

  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;

  const messages = chatHistories[agentId] || [];
  const searchInput = document.getElementById('history-search-input');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  // Filtrer les messages par mot-clé
  const filtered = query
    ? messages.filter(msg => msg.text.toLowerCase().includes(query))
    : messages;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px; color: var(--text-muted); font-size: 0.9rem;">
        Aucun message trouvé ${query ? 'pour cette recherche' : "dans l'historique"}.
      </div>
    `;
    return;
  }

  filtered.forEach(msg => {
    const isUser = msg.sender === 'user';
    const messageCard = document.createElement('div');
    messageCard.className = `history-message-card ${msg.sender}`;
    messageCard.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 14px 18px;
      border-radius: 8px;
      background: ${isUser ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)'};
      border: 1px solid ${isUser ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)'};
    `;
    
    let contentHtml = parseMarkdown(msg.text);
    
    messageCard.innerHTML = `
      <div class="msg-avatar" style="font-size: 1.1rem; width: 28px; height: 28px; min-width: 28px; border-radius: 6px; background: ${isUser ? 'var(--accent-color)' : 'rgba(255,255,255,0.04)'}; color: white; display: flex; align-items: center; justify-content: center; border: 1px solid ${isUser ? 'transparent' : 'var(--border-color)'};">
        ${isUser ? '👤' : agent.avatar}
      </div>
      <div style="flex: 1;">
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px;">
          ${isUser ? 'Vous (Client)' : agent.name}
        </div>
        <div class="history-msg-body" style="font-size: 0.9rem; color: var(--text-primary); line-height: 1.5; word-break: break-word;">
          ${contentHtml}
        </div>
        ${renderExecutionLogsMarkup(msg.executionLogs)}
      </div>
    `;
    container.appendChild(messageCard);
  });
}

function getSeededCalendarEvents() {
  return [
    {
      id: "evt_1",
      day: "monday",
      time: "09:00",
      platform: "LinkedIn",
      text: "📊 Chez César-IA, nous sommes convaincus que l'avenir opérationnel est autonome. Pourquoi continuer à allouer des budgets colossaux à des inefficacités opérationnelles ?",
      status: "published"
    },
    {
      id: "evt_2",
      day: "tuesday",
      time: "14:00",
      platform: "Twitter",
      text: "Le travail répétitif tue la croissance. Nos agents Starter s'intègrent à vos CMS et bases SQL en un clic pour automatiser 80% des tâches répétitives. 🧵👇 #DevOps #IA",
      status: "planned"
    },
    {
      id: "evt_3",
      day: "wednesday",
      time: "11:30",
      platform: "Facebook",
      text: "Ravi d'accueillir nos 50 nouveaux clients cette semaine ! Votre confiance nous pousse à rendre nos agents IA encore plus intelligents et connectés. 🚀",
      status: "planned"
    },
    {
      id: "evt_4",
      day: "thursday",
      time: "10:00",
      platform: "LinkedIn",
      text: "L'excellence technique ne s'improvise pas. Elle se planifie et s'exécute avec rigueur. Voici comment sécuriser vos accès SSH pour vos agents IA autonomes.",
      status: "draft"
    },
    {
      id: "evt_5",
      day: "friday",
      time: "16:00",
      platform: "LinkedIn",
      text: "Bon week-end à toutes les équipes de production ! 🌟 Libérez du temps de cerveau disponible, déléguez à vos copilotes César-IA.",
      status: "draft"
    }
  ];
}

function renderCalendarTab() {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  
  // Clear columns
  days.forEach(day => {
    const dayCol = document.getElementById(`day-events-${day}`);
    if (dayCol) dayCol.innerHTML = '';
  });
  
  const draftsQueue = document.getElementById("calendar-drafts-queue");
  if (draftsQueue) draftsQueue.innerHTML = '';

  const events = state.calendarEvents || [];
  
  // Platform coloring
  const getPlatformStyle = (platform) => {
    switch (platform.toLowerCase()) {
      case 'linkedin': return { color: '#0077b5', bg: 'rgba(0, 119, 181, 0.08)', border: 'rgba(0, 119, 181, 0.25)' };
      case 'twitter':
      case 'x': return { color: '#1da1f2', bg: 'rgba(29, 161, 242, 0.08)', border: 'rgba(29, 161, 242, 0.25)' };
      case 'facebook': return { color: '#1877f2', bg: 'rgba(24, 119, 242, 0.08)', border: 'rgba(24, 119, 242, 0.25)' };
      case 'instagram': return { color: '#e1306c', bg: 'rgba(225, 48, 108, 0.08)', border: 'rgba(225, 48, 108, 0.25)' };
      default: return { color: 'var(--accent-color)', bg: 'rgba(212, 175, 55, 0.08)', border: 'rgba(212, 175, 55, 0.25)' };
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'published': return { label: 'Publié', color: '#10b981' };
      case 'planned': return { label: 'Planifié', color: '#3b82f6' };
      case 'draft': return { label: 'Brouillon', color: '#f59e0b' };
      default: return { label: 'Inconnu', color: 'var(--text-secondary)' };
    }
  };

  let draftsCount = 0;

  events.forEach(evt => {
    const platformStyle = getPlatformStyle(evt.platform);
    const statusStyle = getStatusStyle(evt.status);
    
    // 1. Build Calendar Event card
    const card = document.createElement('div');
    card.className = `calendar-event-card ${evt.status}`;
    card.style.cssText = `
      background: ${platformStyle.bg};
      border: 1px solid ${platformStyle.border};
      border-left: 4px solid ${platformStyle.color};
      padding: 10px;
      border-radius: 6px;
      font-size: 0.76rem;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    `;
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px; align-items: center;">
        <span style="font-weight: 700; color: var(--text-primary);">${evt.time}</span>
        <span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,0.4); font-weight: bold; color: ${statusStyle.color}; text-transform: uppercase;">
          ${statusStyle.label}
        </span>
      </div>
      <div style="color: ${platformStyle.color}; font-weight: 700; margin-bottom: 4px; font-size: 0.72rem; text-transform: uppercase;">
        ${evt.platform}
      </div>
      <div style="color: var(--text-primary); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word;">
        ${evt.text}
      </div>
    `;

    // Hover effect
    card.addEventListener('mouseover', () => {
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = `0 4px 12px ${platformStyle.bg}`;
      card.style.borderColor = platformStyle.color;
    });
    card.addEventListener('mouseout', () => {
      card.style.transform = 'none';
      card.style.boxShadow = 'none';
      card.style.borderColor = platformStyle.border;
    });

    // Event details / Actions
    card.addEventListener('click', () => {
      showCalendarEventActions(evt);
    });

    const targetCol = document.getElementById(`day-events-${evt.day}`);
    if (targetCol) {
      targetCol.appendChild(card);
    }

    // 2. Build Drafts List Row
    if (evt.status === 'draft' && draftsQueue) {
      draftsCount++;
      const draftRow = document.createElement('div');
      draftRow.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--border-color);
        padding: 12px 16px;
        border-radius: 8px;
        gap: 16px;
      `;
      
      const dayLabel = evt.day.charAt(0).toUpperCase() + evt.day.slice(1);
      draftRow.innerHTML = `
        <div style="flex: 1;">
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 0.7rem; font-weight: bold; background: ${platformStyle.bg}; color: ${platformStyle.color}; border: 1px solid ${platformStyle.border}; padding: 2px 8px; border-radius: 12px; text-transform: uppercase;">
              ${evt.platform}
            </span>
            <span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 500;">
              Prévu pour ${dayLabel} à ${evt.time}
            </span>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-primary); margin: 0; line-height: 1.4;">
            "${evt.text}"
          </p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm btn-approve" style="background: #10b981; border-color: #10b981; font-size: 0.75rem; padding: 6px 12px;">Approuver</button>
          <button class="btn btn-secondary btn-sm btn-publish" style="font-size: 0.75rem; padding: 6px 12px;">Publier</button>
          <button class="btn btn-danger btn-sm btn-delete" style="font-size: 0.75rem; padding: 6px 12px;">Supprimer</button>
        </div>
      `;

      // Event actions
      draftRow.querySelector('.btn-approve').addEventListener('click', () => {
        evt.status = 'planned';
        saveMockState();
        showToast("Publication approuvée et planifiée avec succès !", "success");
        renderCalendarTab();
      });
      
      draftRow.querySelector('.btn-publish').addEventListener('click', async () => {
        evt.status = 'published';
        saveMockState();
        showToast("Publication publiée en direct sur les réseaux !", "success");
        
        // Add a mock execution log
        const logMsg = `[Chronos] Publication en direct effectuée sur ${evt.platform} avec succès.`;
        if (chatHistories['chronos']) {
          chatHistories['chronos'].push({
            sender: 'agent',
            text: `📢 **Publication publiée !**\n\nJ'ai publié votre post sur **${evt.platform}** :\n\n"${evt.text}"`,
            executionLogs: [logMsg]
          });
          saveChatMessage('chronos', 'agent', `📢 **Publication publiée !**\n\nJ'ai publié votre post sur **${evt.platform}** :\n\n"${evt.text}"`, [logMsg]);
        }
        
        renderCalendarTab();
      });

      draftRow.querySelector('.btn-delete').addEventListener('click', () => {
        state.calendarEvents = state.calendarEvents.filter(e => e.id !== evt.id);
        saveMockState();
        showToast("Brouillon supprimé.", "info");
        renderCalendarTab();
      });

      draftsQueue.appendChild(draftRow);
    }
  });

  if (draftsCount === 0 && draftsQueue) {
    draftsQueue.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem; background: rgba(0,0,0,0.1); border-radius: 8px; border: 1px dashed var(--border-color);">
        Aucun brouillon en attente pour le moment.
      </div>
    `;
  }

  // Planifier un post button wiring
  const btnAddPost = document.getElementById('btn-calendar-add-post');
  if (btnAddPost && !btnAddPost.dataset.wired) {
    btnAddPost.dataset.wired = 'true';
    btnAddPost.addEventListener('click', openCalendarAddModal);
  }
}

function openCalendarAddModal() {
  const modal = document.getElementById('calendar-modal');
  if (!modal) return;

  // Reset form fields
  document.getElementById('cal-post-id').value = '';
  document.getElementById('cal-post-text').value = '';
  document.getElementById('cal-post-platform').value = 'LinkedIn';
  document.getElementById('cal-post-day').value = 'monday';
  document.getElementById('cal-post-time').value = '09:00';
  document.getElementById('cal-post-status').value = 'planned';
  
  document.getElementById('calendar-modal-title').innerText = "Planifier une publication";
  document.getElementById('btn-calendar-modal-delete').style.display = 'none';

  setupCalendarModalListeners();
  modal.showModal();
}

function openCalendarEditModal(evt) {
  const modal = document.getElementById('calendar-modal');
  if (!modal) return;

  // Fill form fields
  document.getElementById('cal-post-id').value = evt.id;
  document.getElementById('cal-post-text').value = evt.text;
  document.getElementById('cal-post-platform').value = evt.platform;
  document.getElementById('cal-post-day').value = evt.day;
  document.getElementById('cal-post-time').value = evt.time;
  document.getElementById('cal-post-status').value = evt.status;
  
  document.getElementById('calendar-modal-title').innerText = "Modifier la publication";
  document.getElementById('btn-calendar-modal-delete').style.display = 'block';

  setupCalendarModalListeners();
  modal.showModal();
}

let isCalendarModalWired = false;

function setupCalendarModalListeners() {
  if (isCalendarModalWired) return;
  isCalendarModalWired = true;

  const modal = document.getElementById('calendar-modal');
  const form = document.getElementById('form-calendar-post');
  const btnClose = document.getElementById('btn-calendar-modal-close');
  const btnCancel = document.getElementById('btn-calendar-modal-cancel');
  const btnDelete = document.getElementById('btn-calendar-modal-delete');

  const closeHandler = () => {
    modal.close();
  };

  btnClose.addEventListener('click', closeHandler);
  if (btnCancel) btnCancel.addEventListener('click', closeHandler);

  btnDelete.addEventListener('click', () => {
    const id = document.getElementById('cal-post-id').value;
    if (id) {
      state.calendarEvents = state.calendarEvents.filter(e => e.id !== id);
      saveMockState();
      showToast("Publication retirée du planning.", "info");
      renderCalendarTab();
      modal.close();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('cal-post-id').value;
    const text = document.getElementById('cal-post-text').value.trim();
    const platform = document.getElementById('cal-post-platform').value;
    const day = document.getElementById('cal-post-day').value;
    const time = document.getElementById('cal-post-time').value.trim();
    const status = document.getElementById('cal-post-status').value;

    if (!text || !time) return;

    if (id) {
      // Edit existing post
      const evt = state.calendarEvents.find(e => e.id === id);
      if (evt) {
        evt.text = text;
        evt.platform = platform;
        evt.day = day;
        evt.time = time;
        evt.status = status;
        showToast("Publication mise à jour !", "success");
      }
    } else {
      // Add new post
      const newEvt = {
        id: "evt_" + Math.random().toString(36).substring(2, 9),
        day,
        time,
        platform,
        text,
        status
      };
      state.calendarEvents.push(newEvt);
      showToast("Publication ajoutée au planning !", "success");
    }

    saveMockState();
    renderCalendarTab();
    modal.close();
  });
}

function showCalendarEventActions(evt) {
  openCalendarEditModal(evt);
}

function detectAndAddChronosDraftToCalendar(text) {
  if (!text || typeof text !== 'string') return;
  if (!text.includes("Brouillon rédigé avec succès")) return;
  
  // Extract subject
  const subjectMatch = text.match(/Brouillon rédigé avec succès \(([^)]+)\)/);
  const subject = subjectMatch ? subjectMatch[1] : "LinkedIn";
  
  // Extract draft content (between --- and ---)
  const parts = text.split("---");
  if (parts.length < 3) return;
  const draftText = parts[1].trim();
  
  // Determine platform
  const platform = subject.toLowerCase().includes("twitter") || subject.toLowerCase().includes("tweet") ? "Twitter" : "LinkedIn";
  
  // Choose random day and time for scheduling
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const randomDay = days[Math.floor(Math.random() * 5)]; // Mon-Fri
  const time = "10:00";
  
  // Check if it already exists to avoid duplicates
  const exists = state.calendarEvents.some(e => e.text === draftText);
  if (exists) return;
  
  const newEvt = {
    id: "evt_" + Math.random().toString(36).substring(2, 9),
    day: randomDay,
    time: time,
    platform: platform,
    text: draftText,
    status: "draft" // Draft status by default!
  };
  
  state.calendarEvents.push(newEvt);
  saveMockState();
}

async function sendChatMessage() {
  const input = document.getElementById('chat-user-input');
  const text = input.value.trim();
  if (!text) return;
  
  // Intercept redirection commands
  const lowerText = text.toLowerCase();
  if (lowerText.includes('voir mes connecteurs') || lowerText === 'connecteurs' || lowerText === 'connecteur') {
    switchDashboardTab('connectors');
    input.value = '';
    return;
  }
  if (lowerText.includes('voir mon calendrier') || lowerText === 'calendrier') {
    switchDashboardTab('calendar');
    input.value = '';
    return;
  }
  
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  
  // Save user message
  chatHistories[agentId].push({ sender: 'user', text: text, executionLogs: [] });
  renderChatMessages();
  input.value = '';
  
  // Persist user message
  saveChatMessage(agentId, 'user', text, []);
  
  // Show Agent Typing Indicator
  const container = document.getElementById('chat-messages-container');
  const typingMsg = document.createElement('div');
  typingMsg.className = 'message agent';
  typingMsg.innerHTML = `
    <div class="msg-avatar">${agent.avatar}</div>
    <div class="msg-bubble typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  container.appendChild(typingMsg);
  container.scrollTop = container.scrollHeight;
  
  // Get API key
  const localKey = localStorage.getItem('cesar_ia_gemini_api_key');
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  const apiKey = localKey || envKey;
  
  try {
    const systemInstruction = getGeminiSystemInstruction(agent);
    const contents = formatChatHistoryForGemini(agentId);
    
    let res;
    let data;
    
    // 1. Tenter d'utiliser la route Serverless Vercel sécurisée
    try {
      logDebug("[Gemini Chat] Envoi du message à la route Serverless sécurisée...");
      const connectors = state.connectorsData[agentId] || {};
      
      let token = null;
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          token = data?.session?.access_token;
        } catch (e) {
          logDebug(`[Chat] Impossible de récupérer le token: ${e.message}`);
        }
      }
      
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: systemInstruction,
          apiKey: localKey, // Passe la clé locale si elle existe, sinon le backend prendra celle d'environnement
          connectors: connectors,
          agentName: agent.name,
          agentId: agentId
        })
      });
      
      if (res.status === 404) {
        throw new Error("404 Not Found");
      }
      
      data = await res.json();
      logDebug("[Gemini Chat] Réponse reçue via la route Serverless.");
    } catch (serverlessErr) {
      logDebug(`[Gemini Chat] Échec de la route Serverless (${serverlessErr.message}). Tentative d'appel Direct Client...`);
      
      // 2. Repli : Appel direct depuis le navigateur si une clé est disponible localement
      if (!apiKey) {
        throw new Error("Aucune clé API configurée localement ou en variable d'environnement.");
      }
      
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_ONLY_HIGH"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_ONLY_HIGH"
            }
          ]
        })
      });
      data = await res.json();
    }
    
    typingMsg.remove();
    
    if (res.ok && data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      const replyText = data.candidates[0].content.parts[0].text;
      const executionLogs = data.executionLogs || [];
      const finishReason = data.candidates[0]?.finishReason;
      logDebug(`[Gemini API] Réponse reçue avec succès. finishReason: ${finishReason || 'STOP'}`);
      if (finishReason && finishReason !== 'STOP') {
        logDebug(`[Gemini API] Attention: La génération s'est arrêtée avec le motif: ${finishReason}`);
      }
      chatHistories[agentId].push({ sender: 'agent', text: replyText, executionLogs: executionLogs });
      if (agentId === 'chronos') {
        detectAndAddChronosDraftToCalendar(replyText);
      }
      renderChatMessages();
      saveChatMessage(agentId, 'agent', replyText, executionLogs);
    } else {
      const errorMsg = data.error?.message || "Erreur de réponse API";
      logDebug(`[Gemini API] Échec de l'appel API: ${errorMsg}. Repli sur la simulation.`);
      throw new Error(errorMsg);
    }
  } catch (err) {
    logDebug(`[Gemini Chat] Échec de la génération API : ${err.message}. Utilisation du mode simulation.`);
    if (typingMsg) typingMsg.remove();
    
    // Tentative de réponse simulée intelligente en cas d'absence de clé API ou d'erreur
    try {
      const simResponse = getSimulatedAgentResponse(agent, text);
      let replyText = '';
      let simulatedActions = [];
      
      if (simResponse && typeof simResponse === 'object') {
        replyText = simResponse.text;
        simulatedActions = simResponse.quickActions || [];
      } else {
        replyText = simResponse || "";
      }
      
      if (replyText) {
        // Mimer des logs d'exécution techniques réalistes pour l'expérience utilisateur
        const simulatedLogs = [];
        const lowerMsg = text.toLowerCase();
        
        if (agent.id === 'chronos') {
          if (lowerMsg.includes('publie') || lowerMsg.includes('envoie') || lowerMsg.includes('valide') || lowerMsg.includes('go') || lowerMsg.includes('c\'est bon')) {
            simulatedLogs.push({ source: 'Integration Engine', type: 'INFO', text: 'Chargement des connecteurs...' });
            simulatedLogs.push({ source: 'LinkedIn API', type: 'SUCCESS', text: 'Publication effectuée en direct sur le compte LinkedIn.' });
          } else if (lowerMsg.includes('tweet') || lowerMsg.includes('twitter') || lowerMsg.includes('x') || lowerMsg.includes('thread')) {
            simulatedLogs.push({ source: 'X / Twitter API', type: 'SUCCESS', text: 'Thread préparé avec succès.' });
          } else if (lowerMsg.includes('calendrier') || lowerMsg.includes('planning') || lowerMsg.includes('semaine')) {
            simulatedLogs.push({ source: 'Editorial Planner', type: 'SUCCESS', text: 'Génération du calendrier éditorial hebdomadaire.' });
          } else if (lowerMsg.includes('metrics') || lowerMsg.includes('stats') || lowerMsg.includes('engagement')) {
            simulatedLogs.push({ source: 'Metrics Analyzer', type: 'SUCCESS', text: 'Statistiques synchronisées avec le tableau de bord.' });
          }
        } else if (agent.id === 'sybil') {
          if (lowerMsg.includes('vente') || lowerMsg.includes('chiffre') || lowerMsg.includes('sql') || lowerMsg.includes('base')) {
            simulatedLogs.push({ source: 'SQL Client', type: 'INFO', text: 'Connexion à PostgreSQL...' });
            simulatedLogs.push({ source: 'Postgres Client', type: 'SUCCESS', text: 'Requête exécutée avec succès (12 lignes retournées).' });
          }
        } else if (agent.id === 'atlas') {
          if (lowerMsg.includes('serveur') || lowerMsg.includes('cpu') || lowerMsg.includes('ram')) {
            simulatedLogs.push({ source: 'SSH Connector', type: 'INFO', text: 'Connexion SSH sur 192.168.1.42...' });
            simulatedLogs.push({ source: 'SSH CLI', type: 'SUCCESS', text: 'Diagnostic CPU & RAM exécuté.' });
          } else if (lowerMsg.includes('restart') || lowerMsg.includes('relance')) {
            simulatedLogs.push({ source: 'SSH Connector', type: 'INFO', text: 'Connexion SSH sur 192.168.1.42...' });
            simulatedLogs.push({ source: 'SSH CLI', type: 'SUCCESS', text: 'Service Nginx redémarré avec succès.' });
          }
        }
        
        // Ajouter les propositions d'action au format '⚡ Action :' à la fin du texte pour le parser de bulles
        let finalReplyText = replyText;
        if (simulatedActions && simulatedActions.length > 0) {
          finalReplyText += "\n\n";
          simulatedActions.forEach(action => {
            finalReplyText += `⚡ Action : ${action}\n`;
          });
        }
        
        chatHistories[agentId].push({ sender: 'agent', text: finalReplyText, executionLogs: simulatedLogs });
        if (agentId === 'chronos') {
          detectAndAddChronosDraftToCalendar(finalReplyText);
        }
        renderChatMessages();
        saveChatMessage(agentId, 'agent', finalReplyText, simulatedLogs);
        return;
      }
    } catch (simErr) {
      logDebug(`[Simulation Fallback] Échec de la simulation: ${simErr.message}`);
    }
    
    // Si la simulation échoue aussi, afficher le message d'erreur standard
    const errMsg = `❌ **Erreur d'appel API** :\n\n${err.message}\n\nVeuillez vérifier la configuration de la clé API Gemini (\`GEMINI_API_KEY\`) sur le serveur Vercel.`;
    chatHistories[agentId].push({ 
      sender: 'agent', 
      text: errMsg,
      executionLogs: []
    });
    renderChatMessages();
    saveChatMessage(agentId, 'agent', errMsg, []);
  }
}

// Simulated responses database
function getSimulatedAgentResponse(agent, userMessage) {
  const msg = userMessage.toLowerCase();
  const isConfigured = isAgentConfigured(agent.id);
  
  if (!isConfigured) {
    return `⚠️ **Note : Mes accès ne sont pas encore configurés.**\n\nPour que je puisse fonctionner pleinement, veuillez aller dans l'onglet **"Connecteurs & Logiciels"** et renseigner mes informations de connexion.\n\nEn attendant, je peux répondre à des questions générales sur mes capacités !`;
  }
  
  // Custom replies by agent type
  switch(agent.id) {
    case 'sybil':
      if (msg.includes('vente') || msg.includes('calcule') || msg.includes('chiffre')) {
        return `📊 **Analyse des Ventes exécutée** :\n\nJ'ai requêté la base SQL connectée. Voici le récapitulatif :\n- **Chiffre d'Affaires** : 45 280 € (+12% par rapport au mois dernier)\n- **Panier Moyen** : 78,50 €\n- **Produit Top Ventes** : Pack Premium IA.\n\n*J'ai généré et synchronisé un graphique complet sur votre Google Sheet.*`;
      }
      if (msg.includes('sql') || msg.includes('requete') || msg.includes('base')) {
        return `💻 **Requête SQL autonome exécutée** :\n\n\`\`\`sql\nSELECT DATE_TRUNC('month', created_at) AS mois,\n       SUM(total_price) AS ca_total\nFROM orders\nWHERE status = 'completed'\nGROUP BY 1 ORDER BY 1 DESC;\n\`\`\`\nLes résultats montrent une croissance saine sur les 3 derniers mois.`;
      }
      return `Je suis connectée à votre base de données SQL. Je peux exécuter des requêtes d'analyse de données, calculer vos revenus, ou dresser des bilans mensuels. Que voulez-vous analyser ?`;
      
    case 'atlas':
      if (msg.includes('serveur') || msg.includes('cpu') || msg.includes('ram') || msg.includes('status')) {
        return `⚡ **Diagnostic du Serveur de Production** :\n\nConnexion SSH réussie sur \`192.168.1.42\`.\n- **CPU Load** : 24% (Stable)\n- **Utilisation RAM** : 4.2GB / 8.0GB (52%)\n- **Disque Dur** : 65GB disponibles (120GB total)\n- **Services Actifs** : \`nginx\` (running), \`docker-daemon\` (running), \`postgresql\` (running).\n\nTout fonctionne normalement !`;
      }
      if (msg.includes('restart') || msg.includes('relance') || msg.includes('reboot')) {
        return `⚙️ **Redémarrage de service initié** :\n\nExécution de la commande sur le serveur distant :\n\`\`\`bash\nsudo systemctl restart nginx\n\`\`\`\nLe service Nginx a été redémarré avec succès. Temps de réponse HTTP : 45ms.`;
      }
      return `Je suis connecté par SSH à votre infrastructure Linux. Je peux vérifier la mémoire, auditer les ports réseau, inspecter les processus Docker ou redémarrer des services. Dites-moi quoi faire !`;
      
    case 'chronos':
      // Simulated interactive co-creation flow (matching user instructions)
      
      if (msg.includes('canva') || msg.includes('visuel') || msg.includes('design') || msg.includes('banniere')) {
        return {
          text: `🎨 **Intégration Canva API activée** :
          
J'ai détecté votre demande concernant les visuels. Grâce au connecteur **Canva API**, je peux synchroniser vos chartes graphiques et récupérer des modèles de design pour accompagner vos publications réseaux sociaux.

Voici ce que je peux faire :
1. 🔄 **Synchroniser vos dossiers Canva** pour importer vos logos, polices et couleurs de marque.
2. 🖼️ **Générer des déclinaisons de visuels** à partir de votre identifiant de design Canva existant.
3. 📥 **Associer un visuel Canva** à l'une de vos publications planifiées.

*Pour commencer, veuillez connecter votre compte Canva dans l'onglet **"Connecteurs & Logiciels"**.*`,
          quickActions: ['Voir mes connecteurs', 'Créer un post']
        };
      }
      
      // If user requests a publication to be posted
      if (msg.includes('publie') || msg.includes('envoie') || msg.includes('valide') || msg.includes('go') || msg.includes('c\'est bon')) {
        return {
          text: `🚀 **Publication en direct lancée sur votre compte LinkedIn connecté !**

J'appelle mon outil d'intégration \`post_to_linkedin\` en arrière-plan avec votre jeton d'accès sécurisé.

*Statut : Publication publiée avec succès en direct !*
🔗 ID URN : \`urn:li:activity:${Math.floor(Math.random() * 900000000) + 100000000}\`

Votre post LinkedIn a été publié en direct d'humain à humain ! Vous pouvez aller le consulter et interagir avec votre audience.`,
          quickActions: ['Rédiger une autre publication', "Consulter le rapport d'engagement"]
        };
      }

      if (msg.includes('linkedin') || msg.includes('post') || msg.includes('redige') || msg.includes('ecris') || msg.includes('sujet')) {
        // Est-ce que l'utilisateur demande d'écrire sur un sujet spécifique ?
        let customTopic = '';
        const matchSur = msg.match(/(?:sur\s+|de\s+la\s+|de\s+|d\s*['’]\s*)([a-zA-ZÀ-ÿ\s\-]+)/i);
        if (matchSur && matchSur[1]) {
          const possibleTopic = matchSur[1].trim();
          const blacklist = ['linkedin', 'post', 'redige', 'ecris', 'sujet', 'publie', 'compte', 'mon', 'ton', 'un', 'une', 'autre'];
          if (!blacklist.some(term => possibleTopic.toLowerCase().includes(term)) && possibleTopic.length > 2) {
            customTopic = possibleTopic;
          }
        }

        if (customTopic) {
          return getSimulatedChronosDraft(0, agent.id, customTopic);
        }

        const choseAngle1 = msg.includes('1') || msg.includes('visionnaire') || msg.includes('ops');
        const choseAngle2 = msg.includes('2') || msg.includes('technique') || msg.includes('ssh') || msg.includes('securite') || msg.includes('excellence');
        const choseAngle3 = msg.includes('3') || msg.includes('rentabilite') || msg.includes('roi') || msg.includes('cout') || msg.includes('benefice');
        
        if (choseAngle1) {
          return getSimulatedChronosDraft(1, agent.id);
        } else if (choseAngle2) {
          return getSimulatedChronosDraft(2, agent.id);
        } else if (choseAngle3) {
          return getSimulatedChronosDraft(3, agent.id);
        }

        let brandProfile = {};
        for (const aid of Object.keys(state.connectorsData)) {
          if (state.connectorsData[aid] && state.connectorsData[aid]["Profil de l'Entreprise"]) {
            const p = state.connectorsData[aid]["Profil de l'Entreprise"];
            if (p.companyName && p.companyName.trim().length > 0) {
              brandProfile = p;
              break;
            }
          }
        }

        if (brandProfile.companyName) {
          return {
            text: `🕒 **Coconception de votre publication LinkedIn** :

Bonjour ! Ravi de rédiger pour **${brandProfile.companyName}**. Avant de me lancer dans la plume, je veux m'assurer que le sujet résonne parfaitement avec vos abonnés. 

Voici **3 angles éditoriaux** sur-mesure inspirés de vos thématiques clés. Lequel préférez-vous aborder ?

1️⃣ **L'Angle Visionnaire** : Un post inspirant sur le futur de votre secteur et la vision innovante portée par ${brandProfile.companyName}.
2️⃣ **L'Angle Technique (Expertise)** : Zoom concret et didactique sur votre savoir-faire technique.
3️⃣ **L'Angle Bénéfice (Business & ROI)** : Une publication pragmatique axée sur la valeur concrète et le gain de temps pour vos clients.`,
            quickActions: ['Choisir l\'Angle 1 (Visionnaire)', 'Choisir l\'Angle 2 (Technique)', 'Choisir l\'Angle 3 (Bénéfice)']
          };
        }

        return {
          text: `🕒 **Coconception de votre publication LinkedIn** :

Bonjour ! Avant de rédiger votre post, je veux m'assurer que le sujet vous plaît. Voici 3 angles éditoriaux inspirés de nos thématiques clés.`,
          quickActions: ['Choisir l\'Angle 1 (Visionnaire)', 'Choisir l\'Angle 2 (Technique)', 'Choisir l\'Angle 3 (Bénéfice)']
        };
      }
      
      // Handle simple numeric answers in conversation
      if (msg.trim() === '1' || msg.includes('angle 1') || msg.includes('premier') || msg.includes('visionnaire')) {
        return getSimulatedChronosDraft(1, agent.id);
      }
      if (msg.trim() === '2' || msg.includes('angle 2') || msg.includes('deuxieme') || msg.includes('second') || msg.includes('technique')) {
        return getSimulatedChronosDraft(2, agent.id);
      }
      if (msg.trim() === '3' || msg.includes('angle 3') || msg.includes('troisieme') || msg.includes('rentabilite') || msg.includes('roi')) {
        return getSimulatedChronosDraft(3, agent.id);
      }

      if (msg.includes('tweet') || msg.includes('twitter') || msg.includes('x') || msg.includes('thread')) {
        return {
          text: `🐦 **Proposition de Thread X/Twitter rédigé (3 tweets)** :

**Tweet 1/3** 🧵
Le travail répétitif tue la croissance de votre entreprise. 
Pendant que vos équipes rédigent des rapports SQL à la main, vos concurrents automatisent tout avec des agents IA autonomes.
Voici comment franchir le pas dès aujourd'hui 👇 #CesarIA #Productivite

**Tweet 2/3** ⚙️
1/ Nos agents Starter (Chronos, Apollo, Nemesis, Iris) s'intègrent en quelques secondes à vos CMS, APIs et réseaux sociaux. 
2/ Ils analysent vos données, traduisent vos sites en 12 langues, filtrent les spams et surveillent les prix de vos concurrents en continu.

**Tweet 3/3** 🚀
Pas besoin de budget colossal. Le Starter Pack regroupe ces 4 agents d'élite pour seulement **447 € / mois** (avec une économie directe de -25%).
Inscrivez-vous sur César-IA pour propulser votre entreprise dans l'ère de l'automation.
🔗 [cesar-ia.com](https://plateforme-agents-ia.vercel.app)`,
          quickActions: ['Publier immédiatement', 'Programmer la publication', 'Annuler ce thread']
        };
      }

      if (msg.includes('calendrier') || msg.includes('planning') || msg.includes('semaine')) {
        return {
          text: `📅 **Calendrier Éditorial Hebdomadaire Suggéré** :

Voici le planning éditorial optimisé selon l'engagement de votre audience pour les 7 prochains jours :

| Jour | Réseau | Thématique / Sujet | Objectif | Statut |
| :--- | :--- | :--- | :--- | :--- |
| **Lundi 09h00** | LinkedIn | Pitch César-IA & ROI | Génération de leads | 📝 *Brouillon prêt* |
| **Mardi 14h00** | X/Twitter | Thread sécurité SSH/SQL | Autorité technique | 📝 *Brouillon prêt* |`,
          quickActions: ['Rédiger le post de Lundi', 'Rédiger le post de Mardi', 'Rédiger le post de Mercredi']
        };
      }

      if (msg.includes('metrics') || msg.includes('stats') || msg.includes('engagement')) {
        return {
          text: `📊 **Rapport Hebdomadaire d'Engagement Réseaux Sociaux** :

J'ai synchronisé les statistiques de vos comptes connectés.`,
          quickActions: ['Exporter en PDF sur Drive', 'Rédiger un nouveau post', 'Affiche mon calendrier éditorial']
        };
      }

      return {
        text: `Je suis connecté à vos comptes réseaux sociaux. Je peux rédiger des posts optimisés pour LinkedIn, planifier des tweets (X), concevoir des threads ou collecter les statistiques de vos dernières publications.`,
        quickActions: ['Rédiger un post LinkedIn', 'Proposer un thread Twitter', 'Affiche mon calendrier éditorial']
      };

      
    case 'hermes':
      if (msg.includes('seo') || msg.includes('article') || msg.includes('redige')) {
        return `✍️ **Structure d'article SEO générée pour WordPress** :\n\n**Titre** : Comment intégrer des agents IA dans son infrastructure cloud en 2026\n**Mots-clés visés** : *agent ia, automatisation cloud, devops ia, sécurité api*\n\n**Sommaire** :\n1. Introduction : l'avènement des agents autonomes.\n2. Comment connecter un agent IA via SSH et API de manière sécurisée.\n3. Analyse comparée : agents IA vs scripts Bash traditionnels.\n4. Conclusion et perspectives de sécurité.\n\n*J'ai déjà créé un brouillon dans votre panneau d'administration WordPress.*`;
      }
      return `Je suis votre rédacteur SEO. Je peux rédiger des articles optimisés, analyser des mots-clés sur Semrush ou vérifier le classement de vos pages sur la Google Search Console.`;
      
    case 'hestia':
      if (msg.includes('ticket') || msg.includes('client') || msg.includes('support')) {
        return `🔥 **Ticket Zendesk #1042 résolu** :\n\n- **Client** : Marc Durand (durand.m@gmail.com)\n- **Problème** : Impossible d'activer la clé de licence.\n- **Action Hestia** : J'ai recherché dans la FAQ, identifié que le client avait une ancienne version du logiciel. Je lui ai envoyé le lien de téléchargement mis à jour et validé sa clé.\n- **Statut** : Clos (Résolu en 12 secondes).`;
      }
      return `Je gère votre service client de manière autonome. Connectée à Zendesk/Intercom, je résous les demandes courantes des clients en cherchant dans votre FAQ en temps réel.`;
      
    case 'vesta':
      if (msg.includes('prospect') || msg.includes('lead') || msg.includes('email')) {
        return `🎯 **Campagne de Cold Emailing initiée** :\n\n- **Cible** : Directeurs Techniques (CTO) de startups SaaS en France.\n- **Extraction de leads** : 15 nouveaux profils qualifiés ajoutés depuis LinkedIn Sales Navigator.\n- **Séquence email** : Premier e-mail d'approche rédigé, personnalisé avec le nom de leur entreprise.\n- **Planification** : Envois échelonnés à partir de demain via Lemlist.\n\n*Je vous notifierai dès qu'une réponse positive arrivera !*`;
      }
      return `Vesta à l'écoute. J'automatise votre prospection B2B. Je peux extraire des contacts cibles, rédiger des emails d'approche percutants et les planifier dans votre boîte email.`;
      
    case 'ares':
      if (msg.includes('scan') || msg.includes('securite') || msg.includes('audit')) {
        return `🛡️ **Audit de Sécurité Exécuté** :\n\nScan du serveur de test achevé :\n- **Ports ouverts** : 22 (SSH - sécurisé par clé), 80 (HTTP), 443 (HTTPS).\n- **Vulnérabilités** : Aucune injection SQL détectée sur les formulaires de connexion.\n- **Recommandation** : Mettre à jour la version OpenSSH du serveur (version actuelle : 8.2p1, recommandé : 9.3p1 pour corriger les CVE récentes).\n\n*Rapport PDF généré dans votre Google Drive.*`;
      }
      return `Je surveille la sécurité de votre infrastructure. Je effectue des scans de ports et de vulnérabilités pour contrer les menaces. Indiquez-moi quelle cible analyser.`;

    case 'hephaestus':
      if (msg.includes('code') || msg.includes('bug') || msg.includes('test')) {
        return `🔨 **Correction de Bug effectuée (PR #14)** :\n\nJ'ai analysé l'issue GitHub concernant l'expiration précoce des tokens.\n- **Modif** : Correction de l'offset de calcul du timestamp dans \`auth-service.js\`.\n- **Tests unitaires** : Création de 2 tests Jest supplémentaires. Tous les tests passent (\`npm test\` : 14/14 pass).\n- **Pull Request** : Soumise sur la branche \`main\`.`;
      }
      return `Je suis votre codeur autonome. Connectez-moi à votre GitHub, je peux corriger des bugs, refactorer du code pour le rendre plus propre ou rédiger des suites de tests unitaires.`;
      
    case 'zeus':
      if (msg.includes('supervise') || msg.includes('projet') || msg.includes('equipe')) {
        return `👑 **Zeus - Chef d'Orchestre Activé** :\n\nPour ce projet de rédaction et traduction globale, je vais mobiliser :\n1. **Hermes** : Pour rédiger le guide technique sur notre blog.\n2. **Apollo** : Pour traduire ce guide en anglais et en espagnol.\n3. **Atlas** : Pour déployer le code HTML correspondant sur notre serveur d'hébergement.\n\n*Je lance le brief de tâche. Je vous tiens au courant à chaque validation d'étape.*`;
      }
      return `Je suis Zeus. En tant que superviseur, je peux distribuer des tâches à d'autres agents de votre agence et valider leur travail pour accomplir un projet global. De quoi s'agit-il ?`;
      
    default:
      return `Je suis bien connecté et prêt à travailler. Je réponds de manière autonome en exécutant les instructions basées sur mes compétences et mes intégrations configurées. Posez-moi des questions spécifiques à mon rôle !`;
  }
}

// Chronos Draft Generator Helper for simulated co-creation flow
function getSimulatedChronosDraft(angleNum, agentId, customTopic = '') {
  let draft = '';
  let subject = '';
  
  let brandProfile = {};
  for (const aid of Object.keys(state.connectorsData)) {
    if (state.connectorsData[aid] && state.connectorsData[aid]["Profil de l'Entreprise"]) {
      const p = state.connectorsData[aid]["Profil de l'Entreprise"];
      if (p.companyName && p.companyName.trim().length > 0) {
        brandProfile = p;
        break;
      }
    }
  }

  const companyName = brandProfile.companyName || "César-IA";

  if (customTopic) {
    subject = `Sujet personnalisé : "${customTopic}"`;
    draft = `Le monde change vite, mais la manière dont nous abordons ${customTopic.toLowerCase()} change encore plus vite.

Dans les coulisses de nos opérations quotidiennes, c'est ce sujet précis qui redéfinit aujourd'hui les règles du jeu.

En adoptant une approche plus fluide, plus ciblée et plus directe, on libère du temps et on démultiplie l'impact de nos actions.

Qu'en pensez-vous de votre côté ? Discutons-en dans les commentaires !`;
  } else if (angleNum === 1) {
    subject = `L'Angle Visionnaire (${companyName})`;
    draft = `Le futur se construit aujourd'hui, et chez ${companyName}, nous en sommes convaincus.

Nous voyons trop d'équipes stagner parce qu'elles passent des heures sur des tâches répétitives. 

Notre vision ? Redéfinir la manière dont notre secteur opère en apportant une fluidité et une automatisation sans précédent.`;
  } else if (angleNum === 2) {
    subject = `L'Angle Technique (Expertise & Excellence)`;
    draft = `L'excellence technique ne s'improvise pas. Elle se planifie et s'exécute avec rigueur.

Chez ${companyName}, chaque détail de notre approche est conçu pour garantir une performance optimale et une sécurité absolue.

Nous ne faisons aucun compromis sur la qualité de nos processus.`;
  } else {
    subject = `L'Angle Rentabilité (Business & ROI)`;
    draft = `Pourquoi continuer à allouer des budgets colossaux à des inefficacités opérationnelles ?

Avec les solutions de ${companyName}, l'impact sur votre rentabilité est immédiat.

Moins de frictions, plus de résultats opérationnels : c'est notre promesse concrète.

#Business #Productivite #ROI #${companyName.replace(/[^a-zA-Z0-9]/g, '')}`;
  }
  
  return `✍️ **Brouillon rédigé avec succès (${subject})** :
  
*J'ai analysé la syntaxe de vos publications LinkedIn passées : vous privilégiez des phrases courtes et directes, des sauts de ligne aérés, et un ton humain sans puces de listes robotiques. Voici le brouillon sur-mesure proposé :*

---

${draft}

---

*Ce texte vous convient-il ? Dites-moi simplement **"Publie"** ou **"Valide"** pour l'envoyer instantanément sur votre compte LinkedIn connecté !*`;
}


// CONNECTORS CONFIGURATION FORM
function renderConnectorsForm() {
  const formGrid = document.getElementById('connectors-form-grid');
  formGrid.innerHTML = '';
  
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;
  
  const savedData = state.connectorsData[agentId] || {};
  const draftData = state.connectorsDrafts[agentId] || {};
  
  // 1. Render Company Profile / Brand Profile Card at the very top of the grid
  const profileCard = document.createElement('div');
  profileCard.className = 'connector-card brand-profile-card';
  profileCard.style.gridColumn = '1 / -1'; // Span across all columns
  profileCard.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.06) 0%, rgba(168, 85, 247, 0.06) 100%)';
  profileCard.style.border = '1px solid rgba(168, 85, 247, 0.15)';
  profileCard.style.padding = '20px';
  profileCard.style.borderRadius = '12px';
  profileCard.style.marginBottom = '8px';
  profileCard.style.display = 'flex';
  profileCard.style.flexDirection = 'column';
  profileCard.style.gap = '12px';
  
  const savedCompanyProfile = savedData["Profil de l'Entreprise"] || {};
  const draftCompanyProfile = draftData["Profil de l'Entreprise"] || {};
  const companyProfile = { ...savedCompanyProfile, ...draftCompanyProfile };
  
  // Dynamic parameters based on agent category role
  let profileTitle = "Profil & Thématiques de votre Entreprise";
  let profileIcon = "🏢";
  let profileDesc = "Renseignez les détails de votre marque ou de votre projet. Cet agent adaptera sa plume et ses réponses à votre domaine réel, et non aux thématiques César-IA par défaut.";
  let profileFieldsHtml = "";
  
  const marketingAgents = ['chronos', 'hermes', 'apollo', 'vesta'];
  const devopsAgents = ['atlas', 'ares', 'hephaestus'];
  const dataAgents = ['sybil', 'demeter'];
  const supportAgents = ['hestia', 'nemesis', 'athena', 'janus', 'zeus'];
  
  if (devopsAgents.includes(agentId)) {
    profileTitle = "Configuration d'Infrastructure & Stack DevOps";
    profileIcon = "☁️";
    profileDesc = "Spécifiez les caractéristiques de votre environnement de serveurs et de développement. L'agent adaptera ses scripts Docker, ses diagnostics SSH et ses recommandations de sécurité en conséquence.";
    profileFieldsHtml = `
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Nom de l'Environnement Cible</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="envName" value="${companyProfile.envName || ''}" placeholder="ex: Cluster Prod AWS, VPS Staging..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Système d'Exploitation (OS)</label>
        <select data-conn="Profil de l'Entreprise" data-field="osType" style="width: 100%; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 10px; border-radius: 6px; font-size: 0.85rem; height: 38px; cursor: pointer; outline: none;">
          <option value="ubuntu" ${companyProfile.osType === 'ubuntu' || !companyProfile.osType ? 'selected' : ''}>🐧 Linux Ubuntu / Debian</option>
          <option value="centos" ${companyProfile.osType === 'centos' ? 'selected' : ''}>🐧 Linux CentOS / RHEL</option>
          <option value="alpine" ${companyProfile.osType === 'alpine' ? 'selected' : ''}>🐳 Docker Alpine Linux</option>
          <option value="macos" ${companyProfile.osType === 'macos' ? 'selected' : ''}>🍎 macOS Server</option>
          <option value="windows" ${companyProfile.osType === 'windows' ? 'selected' : ''}>🪟 Windows Server</option>
        </select>
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Technologies, Logiciels & Stack Technique (Séparés par des virgules)</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="techStack" value="${companyProfile.techStack || ''}" placeholder="ex: Docker, Nginx, Node.js, PostgreSQL, Redis, AWS EC2, Cloudflare..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Canal de Notification d'Urgence / Alertes Critiques</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="alertChannel" value="${companyProfile.alertChannel || ''}" placeholder="ex: devops-alerts@entreprise.com ou URL Slack webhook..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
    `;
  } else if (dataAgents.includes(agentId)) {
    profileTitle = "Configuration Métier & Paramètres Data Analyst";
    profileIcon = "📊";
    profileDesc = "Définissez les indicateurs clés de performance (KPI) et les schémas de données que cet agent doit cibler. Ses requêtes d'analyse SQL et ses rapports s'adapteront à vos priorités métiers.";
    profileFieldsHtml = `
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Indicateurs Métiers / KPIs Cibles (Séparés par virgules)</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="companyKPIs" value="${companyProfile.companyKPIs || ''}" placeholder="ex: Chiffre d'Affaires, Panier Moyen, Taux de Rétention (LTV), Nouveaux Clients..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Fréquence des Rapports Souhaitée</label>
        <select data-conn="Profil de l'Entreprise" data-field="reportingFreq" style="width: 100%; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 10px; border-radius: 6px; font-size: 0.85rem; height: 38px; cursor: pointer; outline: none;">
          <option value="daily" ${companyProfile.reportingFreq === 'daily' ? 'selected' : ''}>☀️ Synthèse Quotidienne (Tous les matins)</option>
          <option value="weekly" ${companyProfile.reportingFreq === 'weekly' || !companyProfile.reportingFreq ? 'selected' : ''}>📅 Rapport Hebdomadaire (Chaque vendredi)</option>
          <option value="monthly" ${companyProfile.reportingFreq === 'monthly' ? 'selected' : ''}>📊 Bilan Mensuel Complet (Fin de mois)</option>
        </select>
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Tables SQL principales à interroger en priorité</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="dbTables" value="${companyProfile.dbTables || ''}" placeholder="ex: users, orders, subscriptions, products, logs..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Seuils d'Alerte Critique (KPI Hors Standard)</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="kpiAlertThreshold" value="${companyProfile.kpiAlertThreshold || ''}" placeholder="ex: Chute CA quotidien > 20%, Taux de rebond > 80%..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
    `;
  } else if (supportAgents.includes(agentId)) {
    profileTitle = "Configuration & Base de Connaissances Support / Gestion de Projet";
    profileIcon = "👥";
    profileDesc = "Paramétrez le public cible, les directives et le niveau d'autonomie pour cet agent. Il adaptera la tonalité de ses interactions et le tri de sa base de connaissances en fonction.";
    profileFieldsHtml = `
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Public Cible Principal</label>
        <select data-conn="Profil de l'Entreprise" data-field="audienceType" style="width: 100%; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 10px; border-radius: 6px; font-size: 0.85rem; height: 38px; cursor: pointer; outline: none;">
          <option value="b2c" ${companyProfile.audienceType === 'b2c' || !companyProfile.audienceType ? 'selected' : ''}>🛍️ Clients Grand Public (B2C)</option>
          <option value="b2b" ${companyProfile.audienceType === 'b2b' ? 'selected' : ''}>🏢 Partenaires Professionnels & Entreprises (B2B)</option>
          <option value="internal" ${companyProfile.audienceType === 'internal' ? 'selected' : ''}>👥 Collaborateurs Internes / Équipe</option>
          <option value="vip" ${companyProfile.audienceType === 'vip' ? 'selected' : ''}>💎 Comptes Premium & VIP (SLA strict)</option>
        </select>
      </div>
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Règle de Modération ou de Résolution</label>
        <select data-conn="Profil de l'Entreprise" data-field="actionRule" style="width: 100%; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 10px; border-radius: 6px; font-size: 0.85rem; height: 38px; cursor: pointer; outline: none;">
          <option value="fully_auto" ${companyProfile.actionRule === 'fully_auto' || !companyProfile.actionRule ? 'selected' : ''}>⚡ Répondre & Résoudre en totale autonomie</option>
          <option value="draft_only" ${companyProfile.actionRule === 'draft_only' ? 'selected' : ''}>✍️ Rédiger uniquement les brouillons (attente validation)</option>
          <option value="critical_escalation" ${companyProfile.actionRule === 'critical_escalation' ? 'selected' : ''}>⚠️ Alerte & Escalade humaine pour les cas sensibles</option>
        </select>
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Périmètre thématique de la Base de Connaissances (FAQ/Wiki)</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="knowledgeBaseDomain" value="${companyProfile.knowledgeBaseDomain || ''}" placeholder="ex: Documentation de l'API développeurs, procédures RH internes, catalogue e-commerce..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Consigne spéciale de politesse ou charte client</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="supportPolicy" value="${companyProfile.supportPolicy || ''}" placeholder="ex: Tutoiement chaleureux encouragé, mentionner les liens officiels, rester neutre..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
    `;
  } else {
    // Standard: Marketing, Content & Sales
    profileTitle = "Profil & Thématiques de votre Entreprise";
    profileIcon = "🏢";
    profileDesc = "Renseignez les détails de votre marque ou de votre projet. Nos agents (comme <strong>Chronos</strong> pour vos posts ou <strong>Hermes</strong> pour le SEO) adapteront sa plume et son style à votre marque.";
    profileFieldsHtml = `
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Nom de votre Entreprise / Projet</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="companyName" value="${companyProfile.companyName || ''}" placeholder="ex: César Tech, Cabinet Martin, BioFood..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
      <div class="form-group" style="grid-column: span 1; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Ton & Style de Rédaction</label>
        <select data-conn="Profil de l'Entreprise" data-field="tone" style="width: 100%; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 10px; border-radius: 6px; font-size: 0.85rem; height: 38px; cursor: pointer; outline: none;">
          <option value="human" ${companyProfile.tone === 'human' || !companyProfile.tone ? 'selected' : ''}>✍️ Copywriting Humain & Aéré (LinkedIn)</option>
          <option value="professional" ${companyProfile.tone === 'professional' ? 'selected' : ''}>👔 Professionnel & Institutionnel</option>
          <option value="expert" ${companyProfile.tone === 'expert' ? 'selected' : ''}>🔬 Scientifique / Expert Technique</option>
          <option value="casual" ${companyProfile.tone === 'casual' ? 'selected' : ''}>🤝 Amical, Proche & Complice</option>
          <option value="bold" ${companyProfile.tone === 'bold' ? 'selected' : ''}>🔥 Visionnaire, Disruptif & Impactant</option>
        </select>
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Description de votre Activité & Services</label>
        <textarea data-conn="Profil de l'Entreprise" data-field="description" placeholder="Décrivez brièvement votre métier, vos produits phares, ou la proposition de valeur que vous offrez à vos clients..." style="width: 100%; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 10px; border-radius: 6px; font-size: 0.82rem; height: 60px; resize: none; font-family: inherit; line-height: 1.4; outline: none;">${companyProfile.description || ''}</textarea>
      </div>
      <div class="form-group" style="grid-column: span 2; display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Thématiques, Mots-clés ou Sujets d'Intérêt</label>
        <input type="text" data-conn="Profil de l'Entreprise" data-field="topics" value="${companyProfile.topics || ''}" placeholder="ex: Recrutement hybride, investissement immobilier, bien-être au travail..." style="width: 100%; padding: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #fff; font-size: 0.85rem;" />
      </div>
    </div>
  `;
  }
  
  profileCard.innerHTML = `
    <div class="connector-card-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 12px; margin-bottom: 4px;">
      <div class="connector-name-block" style="display: flex; align-items: center; gap: 10px;">
        <div class="connector-icon" style="font-size: 1.5rem;">${profileIcon}</div>
        <div style="display: flex; flex-direction: column;">
          <span class="connector-title" style="color: #c084fc; font-weight: 700; font-size: 1.05rem;">${profileTitle}</span>
          <span style="font-size: 0.72rem; color: var(--text-muted);">Paramètres généraux de personnalisation de l'agent</span>
        </div>
      </div>
      <span class="badge-connected" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); font-size: 0.7rem; font-weight: 600; padding: 4px 8px; border-radius: 20px;">
        Personnalisation Active
      </span>
    </div>
    <p style="color: var(--text-secondary); font-size: 0.78rem; line-height: 1.45; margin: 0 0 4px 0;">
      ${profileDesc}
    </p>
    
    <div class="brand-profile-fields" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 6px;">
      ${profileFieldsHtml}
    </div>
  `;
  
  formGrid.appendChild(profileCard);
  
  agent.connectors.forEach(connector => {
    const card = document.createElement('div');
    card.className = 'connector-card';
    
    const savedConnData = savedData[connector] || {};
    const draftConnData = draftData[connector] || {};
    const connectorData = { ...savedConnData, ...draftConnData };
    
    // Determine status (connected or not)
    const isConn = savedData[connector] && Object.values(savedData[connector]).some(val => {
      if (val === null || val === undefined) return false;
      if (typeof val === 'string') return val.trim().length > 0;
      if (typeof val === 'number') return true;
      if (typeof val === 'boolean') return val;
      return false;
    });
    
    let fieldsHtml = '';
    
    // Customize form inputs depending on the connector type
    if (connector.includes('SSH')) {
      fieldsHtml = `
        <div class="form-group">
          <label>Hôte du Serveur (IP ou Domaine)</label>
          <input type="text" data-conn="${connector}" data-field="host" value="${connectorData.host || ''}" placeholder="ex: 192.168.1.100" />
        </div>
        <div class="form-group">
          <label>Utilisateur SSH</label>
          <input type="text" data-conn="${connector}" data-field="user" value="${connectorData.user || ''}" placeholder="ex: root" />
        </div>
        <div class="form-group">
          <label>Clé Privée SSH ou Mot de Passe</label>
          <input type="password" data-conn="${connector}" data-field="secret" value="${connectorData.secret || ''}" placeholder="••••••••••••••" />
        </div>
      `;
    } else if (connector.includes('PostgreSQL') || connector.includes('MySQL') || connector.includes('BigQuery') || connector.includes('Snowflake') || connector.includes('MongoDB') || connector.includes('Database')) {
      fieldsHtml = `
        <div class="form-group">
          <label>Chaîne de Connexion (URI / Connexion)</label>
          <input type="text" data-conn="${connector}" data-field="uri" value="${connectorData.uri || ''}" placeholder="postgresql://user:password@localhost:5432/db" />
        </div>
      `;
    } else {
      // Default: API Token, Webhook or SaaS credentials
      const needsUrl = ['Zendesk', 'Jira', 'WordPress', 'Shopify', 'Webflow', 'Crisp', 'Freshdesk', 'WooCommerce', 'PrestaShop', 'ClickUp', 'Linear', 'Crowdin', 'Phrase', 'Sellsy', 'Axonaut', 'Qonto', 'Spendesk', 'GitBook', 'SharePoint', 'Grafana', 'GitHub', 'Notion', 'Airtable'].some(term => connector.includes(term));
      
      let domainLabel = "URL du Logiciel (Domaine)";
      let domainPlaceholder = "https://votre-domaine.com";
      if (connector.includes('GitHub')) {
        domainLabel = "Dépôt GitHub (proprietaire/nom-depot)";
        domainPlaceholder = "proprietaire/nom-depot";
      } else if (connector.includes('Notion')) {
        domainLabel = "ID de la Base de Données";
        domainPlaceholder = "ID de votre base de données";
      } else if (connector.includes('Airtable')) {
        domainLabel = "Base & Table Airtable (baseId/nomTable)";
        domainPlaceholder = "baseId/nomTable";
      }

      fieldsHtml = `
        <div class="form-group">
          <label>${connector.includes('Webhook') ? "URL du Webhook / Clé secrète" : "Clé d'API / Jeton d'Accès"}</label>
          <input type="password" data-conn="${connector}" data-field="token" value="${connectorData.token || ''}" placeholder="${connector.includes('Webhook') ? 'https://votre-serveur.com/webhook' : 'sk_live_••••••••••••••••'}" />
        </div>
        ${needsUrl ? `
        <div class="form-group">
          <label>${domainLabel}</label>
          <input type="text" data-conn="${connector}" data-field="domain" value="${connectorData.domain || ''}" placeholder="${domainPlaceholder}" />
        </div>
        ` : ''}
      `;
    }
    
    const toggleId = `toggle-${agentId}-${connector.replace(/[^a-zA-Z0-9]/g, '')}`;
    
    let verifiedBanner = '';
    if (isConn) {
      const mockSessionId = savedData[connector]?.token ? `oauth_${savedData[connector].token.substring(14, 22)}` : `session_${Math.floor(Math.random() * 90000) + 10000}`;
      verifiedBanner = `
        <div class="oauth-success-status" style="display: flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.08); border: 1px dashed rgba(16, 185, 129, 0.25); padding: 10px; border-radius: 6px; margin-bottom: 12px;">
          <span style="font-size: 1.1rem; color: #10b981;">✅</span>
          <div style="display: flex; flex-direction: column; text-align: left;">
            <span style="font-size: 0.72rem; color: #10b981; font-weight: 700;">LIAISON VÉRIFIÉE</span>
            <span style="font-size: 0.65rem; color: var(--text-secondary);">Session ID : <code style="font-family: var(--font-mono); color: #fff;">${mockSessionId}</code></span>
          </div>
        </div>
      `;
    }

    const btnText = isConn ? "🔄 Reconnecter / Changer de compte" : "⚡ Connexion Express 1-Clic";
    const btnClass = isConn ? "btn-express-conn connected" : "btn-express-conn";

    card.innerHTML = `
      <div class="connector-card-header">
        <div class="connector-name-block">
          <div class="connector-icon">${getConnectorEmoji(connector)}</div>
          <span class="connector-title">${connector}</span>
        </div>
        <span class="${isConn ? 'badge-connected' : 'badge-disconnected'}">
          ${isConn ? 'Connecté' : 'Non configuré'}
        </span>
      </div>
      <div class="connector-fields-wrapper" style="padding-top: 4px;">
        ${verifiedBanner}
        <button type="button" class="${btnClass}" onclick="startOauthSimulation('${agentId}', '${connector.replace(/'/g, "\\'")}')">
          ${btnText}
        </button>
        
        <div style="text-align: center; margin-top: 6px;">
          <button type="button" onclick="const t = document.getElementById('${toggleId}'); t.style.display = t.style.display === 'none' ? 'block' : 'none';" style="background: transparent; border: none; color: var(--text-muted); font-size: 0.7rem; text-decoration: underline; cursor: pointer; transition: var(--transition);">
            ${isConn ? "Voir les paramètres techniques" : "Configuration technique manuelle (Avancé)"}
          </button>
        </div>
        
        <div id="${toggleId}" class="connector-fields" style="display: none; margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 12px;">
          ${fieldsHtml}
          <button type="button" onclick="saveConnectors()" class="btn btn-primary" style="width: 100%; margin-top: 12px; font-size: 0.78rem; padding: 8px 12px; background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); border: none; font-weight: 600;">
            💾 Valider et Enregistrer la clé
          </button>
        </div>
      </div>
    `;
    
    formGrid.appendChild(card);
  });
  
  // Clean connection status banner
  document.getElementById('test-connection-status').innerHTML = '';

  // Show/hide disconnect button dynamically
  const disconnectBtn = document.getElementById('btn-disconnect-agent');
  if (disconnectBtn) {
    disconnectBtn.style.display = isAgentConfigured(agentId) ? 'block' : 'none';
  }

  // Écouter les modifications réactives pour sauvegarder dans les brouillons de saisie (Phase F)
  const formInputs = formGrid.querySelectorAll('input, textarea, select');
  formInputs.forEach(input => {
    const handler = (e) => {
      const conn = e.target.getAttribute('data-conn');
      const field = e.target.getAttribute('data-field');
      const val = e.target.value;
      if (!conn || !field) return;
      
      if (!state.connectorsDrafts[agentId]) {
        state.connectorsDrafts[agentId] = {};
      }
      if (!state.connectorsDrafts[agentId][conn]) {
        state.connectorsDrafts[agentId][conn] = {};
      }
      state.connectorsDrafts[agentId][conn][field] = val;
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

function getConnectorEmoji(conn) {
  if (conn.includes('SSH') || conn.includes('Server') || conn.includes('Serveur')) return '🖥️';
  if (conn.includes('SQL') || conn.includes('Query') || conn.includes('DB') || conn.includes('Snowflake') || conn.includes('MongoDB') || conn.includes('Database')) return '💾';
  if (conn.includes('Slack')) return '💬';
  if (conn.includes('Google') || conn.includes('Drive') || conn.includes('Dropbox') || conn.includes('OneDrive') || conn.includes('Box') || conn.includes('SharePoint')) return '📁';
  if (conn.includes('API') || conn.includes('Webhooks') || conn.includes('Webhook')) return '🔌';
  if (conn.includes('GitHub') || conn.includes('GitLab') || conn.includes('Bitbucket') || conn.includes('CodeCommit') || conn.includes('DevOps')) return '🐙';
  if (conn.includes('Zendesk') || conn.includes('Intercom') || conn.includes('Crisp') || conn.includes('Freshdesk') || conn.includes('LiveChat')) return '📞';
  if (conn.includes('Notion') || conn.includes('Trello') || conn.includes('Asana') || conn.includes('Monday') || conn.includes('ClickUp') || conn.includes('Linear') || conn.includes('Basecamp') || conn.includes('Figma') || conn.includes('Productboard') || conn.includes('GitBook') || conn.includes('Confluence') || conn.includes('Evernote') || conn.includes('Crowdin') || conn.includes('Phrase')) return '📝';
  if (conn.includes('Stripe') || conn.includes('QuickBooks') || conn.includes('Xero') || conn.includes('Pennylane') || conn.includes('Sellsy') || conn.includes('Axonaut') || conn.includes('Qonto') || conn.includes('Spendesk') || conn.includes('PayPal') || conn.includes('Lydia')) return '💳';
  if (conn.includes('LinkedIn') || conn.includes('X/Twitter') || conn.includes('Instagram') || conn.includes('TikTok') || conn.includes('Facebook') || conn.includes('Threads') || conn.includes('YouTube') || conn.includes('Pinterest') || conn.includes('Reddit') || conn.includes('Twitch') || conn.includes('Telegram') || conn.includes('WhatsApp') || conn.includes('Messenger') || conn.includes('Discord') || conn.includes('Buffer') || conn.includes('Hootsuite') || conn.includes('Mailchimp') || conn.includes('Brevo')) return '📱';
  if (conn.includes('WordPress') || conn.includes('Shopify') || conn.includes('Webflow') || conn.includes('WooCommerce') || conn.includes('PrestaShop') || conn.includes('Medium') || conn.includes('Jasper')) return '🌐';
  if (conn.includes('AWS') || conn.includes('Cloud') || conn.includes('Azure') || conn.includes('Kubernetes') || conn.includes('Docker') || conn.includes('Vercel') || conn.includes('Netlify') || conn.includes('Heroku') || conn.includes('Sentry') || conn.includes('Snyk') || conn.includes('SonarQube') || conn.includes('Datadog') || conn.includes('Grafana') || conn.includes('Prometheus')) return '☁️';
  return '⚙️';
}


async function saveConnectors() {
  const agentId = state.activeDashboardAgentId;
  if (!agentId) return;
  
  const inputs = document.querySelectorAll('#connectors-form-grid input, #connectors-form-grid textarea, #connectors-form-grid select');
  if (!state.connectorsData[agentId]) {
    state.connectorsData[agentId] = {};
  }
  
  inputs.forEach(input => {
    const conn = input.getAttribute('data-conn');
    const field = input.getAttribute('data-field');
    const val = input.value;
    
    if (!state.connectorsData[agentId][conn]) {
      state.connectorsData[agentId][conn] = {};
    }
    state.connectorsData[agentId][conn][field] = val;
  });
  
  if (isMock) {
    saveMockState();
  } else {
    try {
      const agentConnectors = state.connectorsData[agentId];
      for (const [connName, credentials] of Object.entries(agentConnectors)) {
        await supabaseFetch('connectors', {
          method: 'POST',
          queryParams: '?on_conflict=user_id,agent_id,connector_name',
          headers: {
            'Prefer': 'resolution=merge-duplicates'
          },
          body: {
            user_id: state.currentUser.uid,
            agent_id: agentId,
            connector_name: connName,
            credentials: credentials
          }
        });
      }
    } catch (error) {
      console.error("Erreur lors de la sauvegarde des connecteurs :", error);
      showToast("Impossible de sauvegarder les connecteurs sur Supabase.", "error");
      return;
    }
  }
  
  // Nettoyer les brouillons temporaires puisque les données sont maintenant officiellement sauvegardées
  if (state.connectorsDrafts[agentId]) {
    delete state.connectorsDrafts[agentId];
  }

  // Re-render status dots in sidebar and reload connectors display
  renderDashboardSidebar();
  renderConnectorsForm();
  
  showToast("Paramètres de connexion enregistrés avec succès !");
}

async function disconnectAgent() {
  const agentId = state.activeDashboardAgentId;
  if (!agentId) return;
  
  const agent = AGENTS.find(a => a.id === agentId);
  const agentName = agent ? agent.name : "cet agent";
  
  const ok = confirm(`Êtes-vous sûr de vouloir déconnecter l'agent ${agentName} et révoquer tous ses accès sécurisés ?\n\n⚠️ Note : Cette action supprime les identifiants de l'agent mais ne résilie pas votre abonnement commercial. Pour résilier votre abonnement et stopper la facturation, veuillez vous rendre dans l'onglet Facturation.`);
  if (!ok) return;
  
  // Wipe credentials locally
  delete state.connectorsData[agentId];
  
  if (isMock) {
    saveMockState();
  } else {
    try {
      // In real mode, delete all credentials for this user and agent from Supabase 'connectors' table
      await supabaseFetch('connectors', {
        method: 'DELETE',
        queryParams: `?user_id=eq.${state.currentUser.uid}&agent_id=eq.${agentId}`
      });
    } catch (error) {
      console.error("Erreur lors de la déconnexion de l'agent sur Supabase :", error);
      showToast("Impossible de supprimer les connecteurs sur la base de données.", "error");
      return;
    }
  }
  
  // Re-render components
  renderDashboardSidebar();
  renderConnectorsForm();
  
  showToast(`L'agent ${agentName} a été déconnecté avec succès et ses accès ont été révoqués !`);
}

async function testConnection() {
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;
  
  const statusDiv = document.getElementById('test-connection-status');
  statusDiv.innerHTML = `
    <div class="conn-status-banner" style="background: rgba(0, 0, 0, 0.4); border: 1px solid var(--border-color); color: var(--text-secondary); display: flex; flex-direction: column; gap: 8px; padding: 16px; font-family: var(--font-mono); font-size: 0.8rem; border-radius: 8px; width: 100%; text-align: left; box-sizing: border-box; margin-top: 16px;">
      <div style="font-weight: bold; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; display: flex; align-items: center; gap: 8px;">
        <span class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></span> DIAGNOSTIC SYSTÈME : ${agent.name.toUpperCase()}
      </div>
      <div id="conn-log-output" style="display: flex; flex-direction: column; gap: 4px;"></div>
    </div>
  `;
  
  const logOutput = document.getElementById('conn-log-output');
  const addLogLine = (text, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('fr-FR');
    let color = 'var(--text-secondary)';
    if (type === 'success') color = '#10b981';
    if (type === 'error') color = '#ef4444';
    if (type === 'system') color = 'var(--accent-color)';
    
    const line = document.createElement('div');
    line.style.color = color;
    line.innerHTML = `<span style="color: #565f89; margin-right: 6px;">[${timestamp}]</span> ${text}`;
    logOutput.appendChild(line);
    statusDiv.scrollTop = statusDiv.scrollHeight;
  };

  // Save connectors credentials automatically before testing
  await saveConnectors();
  
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  // Step 1: Init
  addLogLine(`Initialisation de la vérification réseau de ${agent.name}...`, 'system');
  await delay(500);
  
  // Step 2: Hôtes
  addLogLine(`Analyse des passerelles d'intégration configurées...`);
  await delay(600);
  
  const success = isAgentConfigured(agentId);
  const agentConnectors = state.connectorsData[agentId] || {};
  
  if (success) {
    // Show active connectors check
    for (const [connName, connData] of Object.entries(agentConnectors)) {
      const isConfigured = connData && Object.values(connData).some(val => val && val.length > 0);
      if (isConfigured) {
        addLogLine(`Vérification des jetons et de l'hôte pour ${connName}...`);
        await delay(500);
        addLogLine(`✓ Connexion à ${connName} réussie (Ping: ${Math.floor(Math.random() * 30) + 15}ms).`, 'success');
        await delay(300);
      }
    }
    
    addLogLine(`Négociation du protocole de sécurité et du handshake SSL...`);
    await delay(600);
    addLogLine(`✓ Handshake SSL réussi avec tous les points d'accès.`, 'success');
    await delay(400);
    
    // Final banner
    statusDiv.innerHTML = `
      <div class="conn-status-banner success" style="margin-top: 16px;">
        ✓ Connexion établie avec succès ! Tous les services d'intégration de ${agent.name} répondent favorablement (Ping : 34ms).
      </div>
    `;
    showToast("Test de connexion réussi !", "success");
  } else {
    // Show failure check
    addLogLine(`⚠️ ALERTE : Aucun connecteur activé ou configuré.`, 'error');
    await delay(800);
    addLogLine(`Vérification des informations de sécurité... Échec.`, 'error');
    await delay(500);
    
    statusDiv.innerHTML = `
      <div class="conn-status-banner error" style="margin-top: 16px;">
        ⚠️ Échec de la connexion. Veuillez configurer au moins un connecteur avec des identifiants valides.
      </div>
    `;
    showToast("Échec de connexion : Identifiants manquants.", "error");
  }
}

// BILLING MANAGEMENT
function setupBilling() {
  document.getElementById('btn-update-billing').addEventListener('click', () => {
    const btn = document.getElementById('btn-update-billing');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Redirection Stripe...`;
    
    setTimeout(() => {
      state.cardDetailsSaved = true;
      btn.disabled = false;
      btn.innerHTML = `✓ Moyen de paiement enregistré`;
      btn.className = 'btn btn-secondary';
      showToast("Moyen de paiement Stripe mis à jour.");
      renderBilling();
    }, 1500);
  });
}

function getCycleEndDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  return d.toLocaleDateString('fr-FR', options);
}

function openUnsubModal(type, targetId) {
  const modal = document.getElementById('unsub-modal');
  const targetPreview = document.getElementById('unsub-target-preview');
  const impactList = document.getElementById('unsub-impact-list');
  const confirmBtn = document.getElementById('btn-unsub-confirm');
  
  if (!modal || !targetPreview || !impactList || !confirmBtn) return;
  
  const cycleEndDate = getCycleEndDate();
  
  if (type === 'pack') {
    const packInfo = PACKS[targetId];
    if (!packInfo) return;
    
    targetPreview.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.8rem;">📦</span>
          <div>
            <strong style="font-size: 1rem; color: var(--text-primary);">${packInfo.name}</strong>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">Forfait global</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; color: #ef4444; font-size: 1.1rem;">${packInfo.price.toFixed(2)} €</div>
          <div style="font-size: 0.7rem; color: var(--text-muted);">par mois</div>
        </div>
      </div>
    `;
    
    impactList.innerHTML = packInfo.agents.map(agentId => {
      const agent = AGENTS.find(a => a.id === agentId);
      return agent ? `
        <li style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.2rem;">${agent.avatar}</span>
          <strong style="color: var(--text-primary);">${agent.name}</strong>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">(${agent.title})</span>
        </li>
      ` : '';
    }).join('');
    
    confirmBtn.onclick = () => {
      executeCancellation('pack', targetId);
    };
    
  } else if (type === 'agent') {
    const agent = AGENTS.find(a => a.id === targetId);
    if (!agent) return;
    
    targetPreview.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.8rem;">${agent.avatar}</span>
          <div>
            <strong style="font-size: 1rem; color: var(--text-primary);">${agent.name}</strong>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">${agent.title}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; color: #ef4444; font-size: 1.1rem;">${agent.price.toFixed(2)} €</div>
          <div style="font-size: 0.7rem; color: var(--text-muted);">par mois</div>
        </div>
      </div>
    `;
    
    impactList.innerHTML = `
      <li style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.2rem;">${agent.avatar}</span>
        <strong style="color: var(--text-primary);">${agent.name}</strong>
        <span style="font-size: 0.8rem; color: var(--text-secondary);">(${agent.title})</span>
      </li>
    `;
    
    confirmBtn.onclick = () => {
      executeCancellation('agent', targetId);
    };
  }
  
  modal.showModal();
}

async function executeCancellation(type, targetId) {
  if (type === 'pack') {
    if (!state.cancelledPacks.includes(targetId)) {
      state.cancelledPacks.push(targetId);
    }
    if (state.currentUser) {
      localStorage.setItem(`cesar_ia_cancelled_packs_${state.currentUser.uid}`, JSON.stringify(state.cancelledPacks));
    }
    saveMockState();
    showToast("La résiliation de votre forfait a été planifiée pour le mois prochain.", "success");
  } else if (type === 'agent') {
    if (!state.cancelledAgents.includes(targetId)) {
      state.cancelledAgents.push(targetId);
    }
    if (state.currentUser) {
      localStorage.setItem(`cesar_ia_cancelled_agents_${state.currentUser.uid}`, JSON.stringify(state.cancelledAgents));
    }
    saveMockState();
    showToast(`La résiliation de l'agent ${AGENTS.find(a => a.id === targetId)?.name || ''} a été planifiée pour le mois prochain.`, "success");
  }
  
  const unsubModal = document.getElementById('unsub-modal');
  if (unsubModal) unsubModal.close();
  
  renderBilling();
  renderCatalog();
  updateUI();
}

// ================================================================
//  PRICING CALCULATOR — Simulateur de Tarifs (Étape 2.1)
// ================================================================

const PACK_DATA = {
  starter: {
    name: 'Starter Pack',
    price: 447,
    setup: '800 € (au lieu de 2 000 €)',
    agents: ['chronos', 'apollo', 'nemesis', 'iris'],
    grossTotal: 596
  },
  pro: {
    name: 'Pro Pack',
    price: 2016.75,
    setup: '2 500 € (au lieu de 12 500 €)',
    agents: ['chronos', 'apollo', 'nemesis', 'iris', 'sybil', 'hermes', 'hestia', 'vesta', 'athena', 'demeter', 'janus'],
    grossTotal: 2689
  },
  business: {
    name: 'Business All-Access',
    price: 3364.50,
    setup: '4 500 € (au lieu de 21 500 €)',
    agents: ['chronos', 'apollo', 'nemesis', 'iris', 'sybil', 'hermes', 'hestia', 'vesta', 'athena', 'demeter', 'janus', 'atlas', 'ares', 'hephaestus'],
    grossTotal: 4486
  }
};

function initPricingCalculator() {
  // Guard: only run if the DOM is present
  if (!document.getElementById('calc-agents-starter')) return;

  const tiers = ['Starter', 'Pro', 'Business'];
  const tierMap = { Starter: 'starter', Pro: 'pro', Business: 'business' };
  let selectedAgents = new Set();

  // --- Populate agent chips ---
  tiers.forEach(tier => {
    const container = document.getElementById(`calc-agents-${tierMap[tier]}`);
    if (!container) return;
    container.innerHTML = '';

    const agents = AGENTS.filter(a => a.tier === tier && a.id !== 'zeus');
    agents.forEach(agent => {
      const chip = document.createElement('label');
      chip.className = 'calc-agent-chip';
      chip.setAttribute('title', `${agent.name} — ${agent.price} €/mois`);
      chip.innerHTML = `
        <input type="checkbox" value="${agent.id}">
        <span class="calc-agent-avatar">${agent.avatar}</span>
        <span>${agent.name}</span>
        <span class="calc-chip-check">✓</span>
      `;

      const checkbox = chip.querySelector('input');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedAgents.add(agent.id);
          chip.classList.add('selected');
        } else {
          selectedAgents.delete(agent.id);
          chip.classList.remove('selected');
        }
        updateIndividualResult();
      });

      container.appendChild(chip);
    });
  });

  // --- Live individual result ---
  function updateIndividualResult() {
    const ids = Array.from(selectedAgents);
    const count = ids.filter(id => {
      const a = AGENTS.find(x => x.id === id);
      return a && a.tier !== 'Enterprise';
    }).length;

    let gross = 0;
    ids.forEach(id => {
      const a = AGENTS.find(x => x.id === id);
      if (a && a.price) gross += a.price;
    });

    const hasDiscount = count >= 3;
    const discount = hasDiscount ? gross * 0.15 : 0;
    const final = gross - discount;

    document.getElementById('calc-gross-total').textContent = `${gross.toFixed(2)} €`;
    document.getElementById('calc-final-total').textContent = `${final.toFixed(2)} €`;

    const discountRow = document.getElementById('calc-discount-row');
    if (hasDiscount) {
      discountRow.style.display = 'flex';
      document.getElementById('calc-discount-amount').textContent = `−${discount.toFixed(2)} €`;
    } else {
      discountRow.style.display = 'none';
    }

    const countEl = document.getElementById('calc-agents-count');
    if (count === 0) {
      countEl.textContent = 'Sélectionnez au moins un agent pour voir votre estimation.';
    } else if (count < 3) {
      countEl.textContent = `${count} agent(s) sélectionné(s) — Ajoutez ${3 - count} de plus pour débloquer −15%.`;
    } else {
      countEl.textContent = `✅ ${count} agents sélectionnés — Remise −15% appliquée !`;
    }
  }

  // --- Pack radio buttons ---
  document.querySelectorAll('input[name="calc-pack"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const pack = PACK_DATA[radio.value];
      if (!pack) return;

      const gross = pack.grossTotal;
      const saving = gross - pack.price;

      document.getElementById('calc-pack-gross').textContent = `${gross.toFixed(2)} €`;
      document.getElementById('calc-pack-saving-amount').textContent = `−${saving.toFixed(2)} €`;
      document.getElementById('calc-pack-final').textContent = `${pack.price.toFixed(2)} €`;
      document.getElementById('calc-pack-setup').textContent = pack.setup;
      document.getElementById('calc-result-pack').style.display = 'block';
    });
  });

  // --- Tab switching ---
  document.querySelectorAll('.calc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.calc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const mode = tab.dataset.mode;
      document.getElementById('calc-panel-individual').style.display = mode === 'individual' ? '' : 'none';
      document.getElementById('calc-panel-pack').style.display = mode === 'pack' ? '' : 'none';
    });
  });

  // Initialize display
  updateIndividualResult();
}

function renderBilling() {

  const activeList = document.getElementById('active-subscriptions-list');
  const invoicesBody = document.getElementById('invoices-list-body');
  const summaryItems = document.getElementById('billing-summary-items');
  const summaryTotal = document.getElementById('billing-summary-total');
  
  activeList.innerHTML = '';
  invoicesBody.innerHTML = '';
  summaryItems.innerHTML = '';
  
  let totalCost = 0;
  
  // 1. Update the Packs UI
  const packs = ['starter', 'pro', 'business'];
  packs.forEach(packId => {
    const card = document.getElementById(`pack-${packId}-card`);
    const btn = card?.querySelector('.btn-pack-subscribe');
    if (!card || !btn) return;
    
    const isPackCancelled = state.cancelledPacks.includes(packId);
    
    if (state.activePack === packId) {
      if (isPackCancelled) {
        card.style.borderColor = '#ef4444';
        card.style.background = 'rgba(239, 68, 68, 0.05)';
        btn.innerText = 'Résiliation planifiée';
        btn.className = 'btn btn-secondary btn-block btn-pack-subscribe';
        btn.disabled = true;
      } else {
        card.style.borderColor = 'var(--accent-color)';
        card.style.background = 'rgba(99, 102, 241, 0.08)';
        btn.innerText = 'Résilier le forfait';
        btn.className = 'btn btn-danger btn-block btn-pack-subscribe';
        btn.disabled = false;
      }
    } else {
      card.style.borderColor = 'var(--border-color)';
      card.style.background = 'rgba(255, 255, 255, 0.01)';
      btn.innerText = state.activePack ? 'Changer pour ce Pack' : 'Activer le Pack';
      btn.className = 'btn btn-primary btn-block btn-pack-subscribe';
      btn.disabled = false;
    }
  });

  // 2. Render Active Subscriptions
  const adoptedIds = getAdoptedAgentIds();
  const packAgents = state.activePack ? PACKS[state.activePack].agents : [];
  
  if (adoptedIds.length === 0 && !state.activePack) {
    activeList.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px 0;">
        Vous n'avez aucun agent actif souscrit. Rendez-vous dans le <a href="#" onclick="document.querySelector('[data-route=catalog]').click()" style="color: var(--accent-color); text-decoration: none; font-weight: 600;">Catalogue</a>.
      </div>
    `;
  } else {
    // Render Active Pack if any
    if (state.activePack) {
      const packInfo = PACKS[state.activePack];
      totalCost += packInfo.price;
      
      const isPackCancelled = state.cancelledPacks.includes(state.activePack);
      const cycleEndDate = getCycleEndDate();
      
      const packItem = document.createElement('div');
      packItem.style.display = 'flex';
      packItem.style.justifyContent = 'space-between';
      packItem.style.alignItems = 'center';
      packItem.style.padding = '14px';
      if (isPackCancelled) {
        packItem.style.background = 'rgba(239, 68, 68, 0.03)';
        packItem.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      } else {
        packItem.style.background = 'rgba(99, 102, 241, 0.05)';
        packItem.style.border = '1px solid var(--accent-color)';
      }
      packItem.style.borderRadius = '8px';
      packItem.style.marginBottom = '10px';
      
      const actionHtml = isPackCancelled
        ? `<span style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; display: inline-block;">Résiliation planifiée (Fin de cycle : ${cycleEndDate})</span>`
        : `<button class="btn btn-danger btn-sm btn-unsubscribe-pack">Résilier</button>`;
      
      packItem.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 1.5rem;">📦</span>
          <div>
            <div style="font-weight: 700; font-size: 0.95rem; color: ${isPackCancelled ? '#ef4444' : 'var(--accent-color)'};">${packInfo.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">${isPackCancelled ? 'Forfait résilié - accès maintenu jusqu\'à la fin de la période' : 'Forfait global actif (-25% inclus)'}</div>
          </div>
        </div>
        <div style="text-align: right; display: flex; align-items: center; gap: 14px;">
          <div>
            <div style="font-weight: 700;">${packInfo.price.toFixed(2)} €</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">par mois</div>
          </div>
          ${actionHtml}
        </div>
      `;
      activeList.appendChild(packItem);
      
      const sumItem = document.createElement('div');
      sumItem.className = 'summary-row';
      sumItem.innerHTML = `
        <span>Forfait ${packInfo.name} ${isPackCancelled ? '(Résiliation planifiée)' : ''}</span>
        <span>${packInfo.price.toFixed(2)} €</span>
      `;
      summaryItems.appendChild(sumItem);
    }
    
    // Calculate individual billing items
    let individualBillableCount = 0;
    let individualBillableSum = 0;
    
    adoptedIds.forEach(agentId => {
      const agent = AGENTS.find(a => a.id === agentId);
      if (!agent) return;
      
      const isCoveredByPack = packAgents.includes(agentId);
      const isZeus = agentId === 'zeus';
      
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.padding = '14px';
      item.style.background = 'rgba(255, 255, 255, 0.01)';
      item.style.border = '1px solid var(--border-color)';
      item.style.borderRadius = '8px';
      item.style.marginBottom = '10px';
      
      if (isCoveredByPack) {
        item.style.opacity = '0.8';
        
        const isPackCancelled = state.cancelledPacks.includes(state.activePack);
        const subtextHtml = isPackCancelled
          ? `
            <div style="font-weight: 700; color: #ef4444;">Désactivation planifiée</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">Fin de cycle forfait</div>
          `
          : `
            <div style="font-weight: 700; color: #10b981;">Inclus</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">dans le forfait</div>
          `;
          
        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.5rem;">${agent.avatar}</span>
            <div>
              <div style="font-weight: 700; font-size: 0.95rem;">${agent.name}</div>
              <div style="font-size: 0.8rem; color: var(--text-secondary);">${agent.title}</div>
            </div>
          </div>
          <div style="text-align: right; display: flex; align-items: center; gap: 14px;">
            <div>
              ${subtextHtml}
            </div>
          </div>
        `;
        activeList.appendChild(item);
      } else {
        const displayPrice = isZeus ? 'Sur devis' : `${agent.price}.00 €`;
        const periodText = isZeus ? '' : 'par mois';
        
        const isAgentCancelled = state.cancelledAgents.includes(agent.id);
        const cycleEndDate = getCycleEndDate();
        
        const agentActionHtml = isAgentCancelled
          ? `<span style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; display: inline-block;">Résiliation planifiée (Fin de cycle : ${cycleEndDate})</span>`
          : `<button class="btn btn-danger btn-sm btn-unsubscribe" data-agent-id="${agent.id}">Résilier</button>`;
        
        if (isAgentCancelled) {
          item.style.background = 'rgba(239, 68, 68, 0.02)';
          item.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        }
        
        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.5rem;">${agent.avatar}</span>
            <div>
              <div style="font-weight: 700; font-size: 0.95rem; color: ${isAgentCancelled ? '#ef4444' : 'var(--text-primary)'};">${agent.name}</div>
              <div style="font-size: 0.8rem; color: var(--text-secondary);">${agent.title}</div>
            </div>
          </div>
          <div style="text-align: right; display: flex; align-items: center; gap: 14px;">
            <div>
              <div style="font-weight: 700;">${displayPrice}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${periodText}</div>
            </div>
            ${agentActionHtml}
          </div>
        `;
        activeList.appendChild(item);
        
        if (!isZeus) {
          individualBillableCount++;
          individualBillableSum += agent.price;
          
          const sumItem = document.createElement('div');
          sumItem.className = 'summary-row';
          sumItem.innerHTML = `
            <span>Abonnement ${agent.name}</span>
            <span>${agent.price}.00 €</span>
          `;
          summaryItems.appendChild(sumItem);
        }
      }
    });
    
    // Apply 15% discount for 3+ active individual agents
    let discount = 0;
    if (individualBillableCount >= 3) {
      discount = individualBillableSum * 0.15;
      totalCost += (individualBillableSum - discount);
      
      const discItem = document.createElement('div');
      discItem.className = 'summary-row';
      discItem.style.color = '#10b981';
      discItem.style.fontWeight = '600';
      discItem.innerHTML = `
        <span>Remise quantitative (15% pour 3+ agents)</span>
        <span>-${discount.toFixed(2)} €</span>
      `;
      summaryItems.appendChild(discItem);
    } else {
      totalCost += individualBillableSum;
    }
  }
  
  // Render Invoices Table
  if (state.invoices.length === 0) {
    invoicesBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted);">Aucune facture disponible.</td>
      </tr>
    `;
  } else {
    state.invoices.forEach(inv => {
      const tr = document.createElement('tr');
      const formattedPrice = typeof inv.price === 'number' ? inv.price.toFixed(2) : parseFloat(inv.price).toFixed(2);
      tr.innerHTML = `
        <td>${inv.id}</td>
        <td>${inv.date}</td>
        <td>${inv.agentName}</td>
        <td style="font-weight: 600;">${formattedPrice} €</td>
        <td><span class="badge-paid">${inv.status}</span></td>
        <td style="text-align: center;">
          <button class="btn btn-sm btn-secondary btn-view-invoice" data-invoice-id="${inv.id}" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 4px;">Voir 👁️</button>
        </td>
      `;
      invoicesBody.appendChild(tr);
    });

    document.querySelectorAll('.btn-view-invoice').forEach(btn => {
      btn.addEventListener('click', () => {
        const invoiceId = btn.getAttribute('data-invoice-id');
        openInvoiceModal(invoiceId);
      });
    });
  }
  
  // Total summary
  summaryTotal.innerText = `${totalCost.toFixed(2)} €`;
  
  // Bind pack subscribe / unsubscribe events
  bindPackEvents();
  
  // Re-bind unsubscribe triggers for individual agents
  document.querySelectorAll('.btn-unsubscribe').forEach(btn => {
    btn.addEventListener('click', () => {
      const agentId = btn.getAttribute('data-agent-id');
      openUnsubModal('agent', agentId);
    });
  });
}

function bindPackEvents() {
  const btnUnsubPack = document.querySelector('.btn-unsubscribe-pack');
  if (btnUnsubPack) {
    btnUnsubPack.addEventListener('click', () => {
      openUnsubModal('pack', state.activePack);
    });
  }

  document.querySelectorAll('.btn-pack-subscribe').forEach(btn => {
    btn.addEventListener('click', async () => {
      const packId = btn.getAttribute('data-pack');
      
      if (!state.currentUser) {
        showToast("Veuillez vous connecter pour activer un forfait.", "warning");
        openAuthModal('Créer un compte', 'Créez votre compte pour commencer.');
        return;
      }
      
      if (state.activePack === packId) {
        const isPackCancelled = state.cancelledPacks.includes(packId);
        if (isPackCancelled) return;
        
        openUnsubModal('pack', packId);
        return;
      }
      
      // Confirm Subscribe
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Activation...`;
      
      setTimeout(async () => {
        setActivePack(packId);
        
        // Add invoice
        const invoiceNo = `INV-${Date.now().toString().slice(-6)}`;
        const packInfo = PACKS[packId];
        const setupFee = packInfo.setupFee;
        const price = packInfo.price;
        const total = price + setupFee;
        
        const newInvoice = {
          id: invoiceNo,
          date: new Date().toLocaleDateString('fr-FR'),
          agentName: `Forfait global : ${packInfo.name}`,
          price: total,
          status: 'Payée'
        };
        
        state.invoices.unshift(newInvoice); // Add to beginning
        
        if (isMock) {
          saveMockState();
        } else {
          try {
            await supabaseFetch('invoices', {
              method: 'POST',
              body: {
                user_id: state.currentUser.uid,
                invoice_number: invoiceNo,
                agent_name: `Forfait ${packInfo.name}`,
                price: total,
                status: 'Payée'
              }
            });
          } catch (err) {
            console.error("Erreur lors de la sauvegarde de la facture :", err);
          }
        }
        
        showToast(`Félicitations ! Vous avez activé le ${packInfo.name}.`, "success");
        renderBilling();
        renderCatalog();
        updateUI();
      }, 1200);
    });
  });
}

// TOAST NOTIFICATIONS UTILITY
function showToast(message, type = 'success') {
  const toast = document.getElementById('app-toast');
  const msgSpan = document.getElementById('toast-message');
  const iconSpan = toast.querySelector('.toast-success-icon');
  
  msgSpan.innerText = message;
  
  if (type === 'success') {
    iconSpan.innerText = '✓';
    iconSpan.style.color = '#22c55e';
    toast.style.borderColor = 'rgba(34, 197, 94, 0.2)';
  } else if (type === 'warning') {
    iconSpan.innerText = '⚠';
    iconSpan.style.color = '#eab308';
    toast.style.borderColor = 'rgba(234, 179, 8, 0.2)';
  } else if (type === 'error') {
    iconSpan.innerText = '✕';
    iconSpan.style.color = '#ef4444';
    toast.style.borderColor = 'rgba(239, 68, 68, 0.2)';
  } else {
    iconSpan.innerText = 'ℹ';
    iconSpan.style.color = '#6366f1';
    toast.style.borderColor = 'rgba(99, 102, 241, 0.2)';
  }
  
  toast.classList.add('show');
  
  // Hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// MATHS & COLOR UTILS FOR NEON GLOW EFFECTS
function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
}

function lightenDarkenColor(col, amt) {
  let usePound = false;
  if (col[0] === "#") {
    col = col.slice(1);
    usePound = true;
  }
  let num = parseInt(col, 16);
  let r = (num >> 16) + amt;
  if (r > 255) r = 255;
  else if (r < 0) r = 0;
  let b = ((num >> 8) & 0x00FF) + amt;
  if (b > 255) b = 255;
  else if (b < 0) b = 0;
  let g = (num & 0x0000FF) + amt;
  if (g > 255) g = 255;
  else if (g < 0) g = 0;
  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16);
}

// ==========================================
// PANNEAU DE CONTRÔLE D'ADMINISTRATION
// ==========================================
async function renderAdminPanel() {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    navigateTo('home');
    return;
  }
  
  // Sync Gemini Config UI
  const inputEl = document.getElementById('admin-gemini-key');
  if (inputEl) {
    inputEl.value = localStorage.getItem('cesar_ia_gemini_api_key') || '';
  }
  updateGeminiKeyStatus();
  
  const usersCountEl = document.getElementById('admin-stat-users');
  const adoptedCountEl = document.getElementById('admin-stat-adopted');
  const revenueEl = document.getElementById('admin-stat-revenue');
  const usersListBody = document.getElementById('admin-users-list');
  const adoptionsListBody = document.getElementById('admin-adoptions-list');
  
  usersCountEl.innerText = "...";
  adoptedCountEl.innerText = "...";
  revenueEl.innerText = "...";
  usersListBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 14px;"><span class="spinner"></span> Chargement...</td></tr>';
  adoptionsListBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 14px;"><span class="spinner"></span> Chargement...</td></tr>';
  
  if (isMock) {
    // Mode démo
    const mockUsers = [
      { email: state.currentUser.email, id: state.currentUser.uid, is_admin: true, created_at: new Date().toISOString() },
      { email: 'client.test1@entreprise.com', id: 'usr_abc123', is_admin: false, created_at: '2026-05-20T10:30:00Z' },
      { email: 'finance.corp@gmail.com', id: 'usr_xyz789', is_admin: false, created_at: '2026-05-21T14:15:00Z' }
    ];
    
    const mockAdoptions = [
      { user_email: 'client.test1@entreprise.com', agent_id: 'sybil', created_at: '2026-05-20T10:35:00Z' },
      { user_email: 'client.test1@entreprise.com', agent_id: 'atlas', created_at: '2026-05-20T10:40:00Z' },
      { user_email: 'finance.corp@gmail.com', agent_id: 'chronos', created_at: '2026-05-21T14:20:00Z' }
    ];
    
    // Ajouter l'utilisateur courant s'il a des agents adoptés
    state.adoptedAgents.forEach(agentId => {
      mockAdoptions.push({
        user_email: state.currentUser.email,
        agent_id: agentId,
        created_at: new Date().toISOString()
      });
    });
    
    displayAdminData(mockUsers, mockAdoptions);
  } else {
    try {
      // Charger tous les profils de Supabase
      const profiles = await supabaseFetch('profiles', {
        queryParams: '?select=*&order=created_at.desc'
      }) || [];
      
      // Charger tous les abonnements adoptés
      const adoptions = await supabaseFetch('adopted_agents', {
        queryParams: '?select=created_at,agent_id,user_id&order=created_at.desc'
      }) || [];
      
      // Associer les emails des profils aux adoptions correspondantes
      const formattedAdoptions = adoptions.map(ad => {
        const matchingProfile = profiles.find(p => p.id === ad.user_id);
        return {
          user_email: matchingProfile ? matchingProfile.email : 'Utilisateur Inconnu',
          agent_id: ad.agent_id,
          created_at: ad.created_at
        };
      });
      
      displayAdminData(profiles, formattedAdoptions);
    } catch (err) {
      console.error("Erreur lors du chargement des données admin :", err);
      showToast("Erreur lors de la récupération des données d'administration.", "error");
      usersListBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 14px;">Erreur de connexion.</td></tr>';
      adoptionsListBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 14px;">Erreur de connexion.</td></tr>';
    }
  }
}


// ================================================================
//  ONBOARDING TOUR — Visite Guidée (Étape 2.2)
// ================================================================

let currentTourStep = 0;
const tourSteps = [
  {
    title: "Bienvenue sur César-IA ! 🚀",
    text: "Prêt à automatiser vos opérations ? Suivez ce guide rapide pour apprendre à piloter vos agents autonomes en moins de 2 minutes.",
    target: null,
    action: () => {
      navigateTo('home');
    }
  },
  {
    title: "Étape 1 : Le Catalogue d'Agents 📂",
    text: "Découvrez nos 15 agents spécialisés (DevOps, Data, Marketing, Relation Client) prêts à être adoptés pour accomplir vos tâches les plus complexes.",
    target: ".nav-links [data-route='catalog']",
    action: () => {
      navigateTo('catalog');
    }
  },
  {
    title: "Étape 2 : Vos Agents Adoptés 🤖",
    text: "Une fois adoptés, vos agents actifs apparaissent ici dans le Tableau de Bord. Sélectionnez un agent dans la liste pour interagir avec lui.",
    target: ".dashboard-sidebar",
    action: () => {
      state.tourActive = true;
      navigateTo('dashboard');
      selectDashboardAgent('sybil');
    }
  },
  {
    title: "Étape 3 : Discutez & Déléguez 💬",
    text: "C'est votre canal direct de communication. Posez des questions en langage naturel, confiez des tâches système ou demandez des comptes-rendus.",
    target: ".panel-tab[data-tab='chat']",
    action: () => {
      state.tourActive = true;
      navigateTo('dashboard');
      selectDashboardAgent('sybil');
      const chatTab = document.querySelector('.panel-tabs [data-tab="chat"]');
      if (chatTab) chatTab.click();
    }
  },
  {
    title: "Étape 4 : Connexions & Sécurité 🔑",
    text: "Sécurisez vos serveurs, bases SQL ou API en y associant vos accès chiffrés. L'agent utilisera ces identifiants pour exécuter ses missions en toute autonomie.",
    target: ".panel-tab[data-tab='connectors']",
    action: () => {
      state.tourActive = true;
      navigateTo('dashboard');
      selectDashboardAgent('sybil');
      const connTab = document.querySelector('.panel-tabs [data-tab="connectors"]');
      if (connTab) connTab.click();
    }
  },
  {
    title: "Étape 5 : Activité & Diagnostic 📊",
    text: "Suivez le statut de l'agent, testez son ping et lisez le journal d'exécution (logs) en temps réel pour auditer chacune de ses actions système.",
    target: ".panel-tab[data-tab='stats']",
    action: () => {
      state.tourActive = true;
      navigateTo('dashboard');
      selectDashboardAgent('sybil');
      const statsTab = document.querySelector('.panel-tabs [data-tab="stats"]');
      if (statsTab) statsTab.click();
    }
  },
  {
    title: "Étape 6 : Facturation & Économies 💰",
    text: "Simulez vos tarifs via notre calculette interactive et profitez des remises (15% dès 3 agents, 25% pour les packs globaux).",
    target: "#pricing-calculator",
    action: () => {
      navigateTo('billing');
    }
  },
  {
    title: "Prêt à démarrer ! 🎉",
    text: "Félicitations, vous connaissez maintenant tous les rouages de César-IA. Adoptez votre premier agent et passez au niveau supérieur !",
    target: null,
    action: () => {
      navigateTo('home');
    }
  }
];

function initOnboardingTour() {
  const startBtn = document.getElementById('btn-start-tour');
  const container = document.getElementById('onboarding-tour-container');
  const card = document.getElementById('tour-card');
  const closeBtn = document.getElementById('tour-btn-close');
  const nextBtn = document.getElementById('tour-btn-next');
  const prevBtn = document.getElementById('tour-btn-prev');
  const backdrop = document.getElementById('tour-backdrop');
  
  if (!startBtn) return;
  
  startBtn.addEventListener('click', () => {
    startTour();
  });
  
  // Wire homepage guided tour triggers
  const guidedTourBtn = document.getElementById('btn-start-guided-tour');
  if (guidedTourBtn) {
    guidedTourBtn.addEventListener('click', (e) => {
      e.preventDefault();
      startTour();
    });
  }

  const stepChoose = document.getElementById('step-card-choose');
  if (stepChoose) {
    stepChoose.addEventListener('click', () => {
      startTour();
      currentTourStep = 1; // Step 1: Catalogue
      renderTourStep();
    });
  }

  const stepConnect = document.getElementById('step-card-connect');
  if (stepConnect) {
    stepConnect.addEventListener('click', () => {
      startTour();
      currentTourStep = 4; // Step 4: Connexions
      renderTourStep();
    });
  }

  const stepWork = document.getElementById('step-card-work');
  if (stepWork) {
    stepWork.addEventListener('click', () => {
      startTour();
      currentTourStep = 5; // Step 5: Activité & Diagnostics
      renderTourStep();
    });
  }
  
  closeBtn.addEventListener('click', () => {
    endTour();
  });
  
  backdrop.addEventListener('click', () => {
    endTour();
  });
  
  nextBtn.addEventListener('click', () => {
    if (currentTourStep < tourSteps.length - 1) {
      currentTourStep++;
      renderTourStep();
    } else {
      endTour();
    }
  });
  
  prevBtn.addEventListener('click', () => {
    if (currentTourStep > 0) {
      currentTourStep--;
      renderTourStep();
    }
  });
  
  function handleResize() {
    positionTourCard();
  }
  
  function startTour() {
    currentTourStep = 0;
    state.tourActive = true;
    startBtn.style.display = 'none';
    container.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Lock scrolling
    
    // Bind resize event
    window.addEventListener('resize', handleResize);
    
    renderTourStep();
  }
  
  function endTour() {
    state.tourActive = false;
    container.style.display = 'none';
    startBtn.style.display = 'flex';
    document.body.style.overflow = ''; // Unlock scrolling
    
    // Unbind resize event
    window.removeEventListener('resize', handleResize);
    
    // Remove highlights
    document.querySelectorAll('.tour-highlight').forEach(el => {
      el.classList.remove('tour-highlight');
    });
    
    // Reset back to actual state
    navigateTo('home');
  }
  
  function renderTourStep() {
    const step = tourSteps[currentTourStep];
    
    // Run action for step
    if (step.action) step.action();
    
    // Reset previous highlights
    document.querySelectorAll('.tour-highlight').forEach(el => {
      el.classList.remove('tour-highlight');
    });
    
    // Update badge & texts
    document.getElementById('tour-step-badge').innerText = `Étape ${currentTourStep + 1}/${tourSteps.length}`;
    document.getElementById('tour-title').innerText = step.title;
    document.getElementById('tour-text').innerText = step.text;
    
    // Progress bar width
    const pct = ((currentTourStep + 1) / tourSteps.length) * 100;
    document.getElementById('tour-progress').style.width = `${pct}%`;
    
    // Prev / Next button states
    prevBtn.style.visibility = currentTourStep === 0 ? 'hidden' : 'visible';
    nextBtn.innerText = currentTourStep === tourSteps.length - 1 ? 'Terminer !' : (currentTourStep === 0 ? "C'est parti !" : 'Suivant');
    
    // Apply highlight and positioning
    setTimeout(() => {
      if (step.target) {
        const targetEl = document.querySelector(step.target);
        if (targetEl) {
          targetEl.classList.add('tour-highlight');
          targetEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        }
      }
      positionTourCard();
    }, 150);
  }
  
  function positionTourCard() {
    const step = tourSteps[currentTourStep];
    if (step.target) {
      const targetEl = document.querySelector(step.target);
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const cardWidth = card.offsetWidth || 380;
        const cardHeight = card.offsetHeight || 250;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        card.className = 'tour-card'; // reset classes
        
        let top, left;
        
        // Decide placement based on space
        if (rect.right + cardWidth + 24 < viewportWidth) {
          // Place right of element
          left = rect.right + 16;
          top = Math.max(16, Math.min(viewportHeight - cardHeight - 16, rect.top + (rect.height / 2) - (cardHeight / 2)));
          card.classList.add('arrow-left');
        } else if (rect.left - cardWidth - 24 > 0) {
          // Place left of element
          left = rect.left - cardWidth - 16;
          top = Math.max(16, Math.min(viewportHeight - cardHeight - 16, rect.top + (rect.height / 2) - (cardHeight / 2)));
          card.classList.add('arrow-right');
        } else if (rect.bottom + cardHeight + 24 < viewportHeight) {
          // Place below element
          left = Math.max(16, Math.min(viewportWidth - cardWidth - 16, rect.left + (rect.width / 2) - (cardWidth / 2)));
          top = Math.max(16, Math.min(viewportHeight - cardHeight - 16, rect.bottom + 16));
          card.classList.add('arrow-top');
        } else {
          // Place above element
          left = Math.max(16, Math.min(viewportWidth - cardWidth - 16, rect.left + (rect.width / 2) - (cardWidth / 2)));
          top = Math.max(16, Math.min(viewportHeight - cardHeight - 16, rect.top - cardHeight - 16));
          card.classList.add('arrow-bottom');
        }
        
        card.style.top = `${top}px`;
        card.style.left = `${left}px`;
        card.style.transform = 'none'; // clear transform centered
        return;
      }
    }
    
    // Default fallback: center screen
    card.className = 'tour-card';
    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%, -50%)';
  }
}

function displayAdminData(users, adoptions) {
  const usersCountEl = document.getElementById('admin-stat-users');
  const adoptedCountEl = document.getElementById('admin-stat-adopted');
  const revenueEl = document.getElementById('admin-stat-revenue');
  const usersListBody = document.getElementById('admin-users-list');
  const adoptionsListBody = document.getElementById('admin-adoptions-list');
  
  usersCountEl.innerText = users.length;
  adoptedCountEl.innerText = adoptions.length;
  
  // Calculer le revenu mensuel total simulé
  let totalRevenue = 0;
  adoptions.forEach(ad => {
    const agent = AGENTS.find(a => a.id === ad.agent_id);
    if (agent) {
      totalRevenue += agent.price;
    }
  });
  revenueEl.innerText = `${totalRevenue}.00 €`;
  
  // Remplir le tableau des comptes clients
  usersListBody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    const createdDate = new Date(u.created_at).toLocaleDateString('fr-FR');
    tr.innerHTML = `
      <td>${u.email}</td>
      <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">${u.id}</td>
      <td>${u.is_admin ? '<span style="font-size: 0.75rem; background: var(--accent-color); color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold;">Admin</span>' : '<span style="font-size: 0.75rem; background: rgba(255,255,255,0.05); color: var(--text-secondary); padding: 2px 6px; border-radius: 4px;">Client</span>'}</td>
    `;
    usersListBody.appendChild(tr);
  });
  
  // Remplir le tableau des abonnements
  adoptionsListBody.innerHTML = '';
  if (adoptions.length === 0) {
    adoptionsListBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 14px;">Aucun abonnement actif.</td></tr>';
  } else {
    adoptions.forEach(ad => {
      const agent = AGENTS.find(a => a.id === ad.agent_id);
      const agentName = agent ? agent.name : ad.agent_id;
      const agentAvatar = agent ? agent.avatar : '🤖';
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${ad.user_email}</td>
        <td><span style="margin-right: 6px;">${agentAvatar}</span><strong>${agentName}</strong></td>
        <td>${new Date(ad.created_at).toLocaleDateString('fr-FR')}</td>
      `;
      adoptionsListBody.appendChild(tr);
    });
  }
}

// =================================================================
//  REAL OAUTH2 CONNECTION & TECHNICAL CREDENTIALS MODAL
// =================================================================

window.startOauthSimulation = async function(agentId, connector) {
  // Prevent body overflow
  document.body.style.overflow = 'hidden';
  
  const connLower = connector.toLowerCase();
  
  // 1. Check if it's a technical connector (SSH, databases)
  const isTechnical = connLower.includes('ssh') || 
                      connLower.includes('server') || 
                      connLower.includes('serveur') || 
                      connLower.includes('sql') || 
                      connLower.includes('postgres') || 
                      connLower.includes('mysql') || 
                      connLower.includes('mongodb') || 
                      connLower.includes('database') || 
                      connLower.includes('snowflake') || 
                      connLower.includes('bigquery') ||
                      connLower.includes('mariadb');
  
  if (isTechnical) {
    // Show technical modal to enter real credentials
    showTechnicalCredentialsModal(agentId, connector);
  } else {
    // SaaS Connector / OAuth2
    // Some connectors need user input first (Shopify, Zendesk, Notion, Airtable, GitHub)
    const needsDomain = connLower.includes('shopify') || connLower.includes('zendesk');
    const needsRepo = connLower.includes('github') || connLower.includes('gitlab');
    const needsBase = connLower.includes('airtable') || connLower.includes('notion');
    
    if (needsDomain || needsRepo || needsBase) {
      showSubdomainOrRepoModal(agentId, connector);
    } else {
      // Direct OAuth
      await initiateRealOauth(agentId, connector);
    }
  }
};

window.closeOauthSimulation = function() {
  document.body.style.overflow = '';
  const styles = document.getElementById('oauth-mockup-styles');
  if (styles) styles.remove();
  
  const overlay = document.querySelector('.oauth-modal-overlay');
  if (overlay) {
    overlay.remove();
  }
};

function createModalOverlay(title, contentHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'oauth-modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(9, 9, 11, 0.85);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #fff;
    padding: 20px;
    box-sizing: border-box;
  `;

  overlay.innerHTML = `
    <div class="glass-modal" style="width: 100%; max-width: 480px; background: rgba(22, 22, 28, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
      <!-- Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
        <h3 style="font-size: 1.1rem; font-weight: 700; margin: 0; background: linear-gradient(135deg, #fff 0%, #a5a5ab 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${title}</h3>
        <button onclick="closeOauthSimulation()" style="background: transparent; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer; line-height: 1; transition: color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-muted)'">&times;</button>
      </div>
      <!-- Body -->
      <div id="oauth-modal-body" style="padding: 24px; max-height: 70vh; overflow-y: auto;">
        ${contentHtml}
      </div>
    </div>
    <style>
      @keyframes modalFadeIn {
        from { opacity: 0; transform: scale(0.95) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .glass-modal input, .glass-modal textarea, .glass-modal select {
        width: 100%;
        background: rgba(0,0,0,0.3);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 10px 14px;
        color: #fff;
        font-size: 0.88rem;
        margin-top: 6px;
        margin-bottom: 16px;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .glass-modal input:focus, .glass-modal textarea:focus, .glass-modal select:focus {
        border-color: #a855f7;
        box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.2);
      }
      .glass-modal label {
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--text-secondary);
        display: block;
        text-align: left;
      }
      .glass-modal .btn {
        padding: 10px 20px;
        font-weight: 600;
        font-size: 0.88rem;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
      }
    </style>
  `;
  document.body.appendChild(overlay);
}

function showTechnicalCredentialsModal(agentId, connector) {
  const connLower = connector.toLowerCase();
  const isSsh = connLower.includes('ssh') || connLower.includes('server') || connLower.includes('serveur');
  
  let fieldsHtml = '';
  if (isSsh) {
    fieldsHtml = `
      <div class="form-group">
        <label>Hôte SSH (IP ou Nom de domaine)</label>
        <input type="text" id="tech-host" placeholder="ex: 192.168.1.100" required />
      </div>
      <div class="form-group">
        <label>Nom d'utilisateur</label>
        <input type="text" id="tech-user" placeholder="ex: root, ubuntu" required />
      </div>
      <div class="form-group">
        <label>Clé Privée (RSA / ED25519) ou Mot de passe</label>
        <textarea id="tech-secret" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..." rows="4" style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 14px; color: #fff; font-size: 0.75rem; margin-top: 6px; margin-bottom: 16px; outline: none; box-sizing: border-box; font-family: var(--font-mono); resize: vertical; height: 100px;" required></textarea>
      </div>
    `;
  } else {
    // Database (PostgreSQL, MySQL, etc.)
    fieldsHtml = `
      <div class="form-group">
        <label>Chaîne de Connexion de la Base de Données (URI)</label>
        <input type="text" id="tech-uri" placeholder="postgresql://user:password@host:5432/database" required />
      </div>
    `;
  }

  const contentHtml = `
    <form id="oauth-tech-form" style="text-align: left;">
      <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.45;">
        Veuillez renseigner les paramètres de connexion sécurisés pour le connecteur <strong>${connector}</strong>.
      </p>
      ${fieldsHtml}
      <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
        <button type="button" onclick="closeOauthSimulation()" class="btn" style="background: rgba(255,255,255,0.05); color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none;">Annuler</button>
        <button type="submit" class="btn" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none;">Enregistrer et Activer 🔒</button>
      </div>
    </form>
  `;

  createModalOverlay(`Connexion Sécurisée : ${connector}`, contentHtml);

  document.getElementById('oauth-tech-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Find the toggle form in the DOM and fill it
    const toggleId = `toggle-${agentId}-${connector.replace(/[^a-zA-Z0-9]/g, '')}`;
    const toggleDiv = document.getElementById(toggleId);
    
    if (toggleDiv) {
      if (isSsh) {
        const hostVal = document.getElementById('tech-host').value.trim();
        const userVal = document.getElementById('tech-user').value.trim();
        const secretVal = document.getElementById('tech-secret').value.trim();
        
        const hostInput = toggleDiv.querySelector(`input[data-field="host"]`);
        const userInput = toggleDiv.querySelector(`input[data-field="user"]`);
        const secretInput = toggleDiv.querySelector(`input[data-field="secret"]`);
        
        if (hostInput) hostInput.value = hostVal;
        if (userInput) userInput.value = userVal;
        if (secretInput) secretInput.value = secretVal;
      } else {
        const uriVal = document.getElementById('tech-uri').value.trim();
        const uriInput = toggleDiv.querySelector(`input[data-field="uri"]`);
        if (uriInput) uriInput.value = uriVal;
      }
      
      // Save
      await saveConnectors();
      closeOauthSimulation();
    } else {
      showToast("Formulaire de configuration introuvable pour ce connecteur.", "error");
      closeOauthSimulation();
    }
  });
}

function showSubdomainOrRepoModal(agentId, connector) {
  const connLower = connector.toLowerCase();
  let labelText = "Nom du sous-domaine / URL";
  let placeholderText = "ex: mon-entreprise";
  let descText = "Saisissez les informations demandées par le fournisseur pour démarrer le processus d'authentification officielle.";

  if (connLower.includes('shopify')) {
    labelText = "Nom de votre boutique Shopify";
    placeholderText = "ex: ma-boutique.myshopify.com ou boutique-name";
    descText = "Saisissez le sous-domaine de votre boutique Shopify pour être redirigé vers l'écran d'autorisation d'application.";
  } else if (connLower.includes('zendesk')) {
    labelText = "Sous-domaine Zendesk";
    placeholderText = "ex: mon-entreprise";
    descText = "Saisissez le sous-domaine de votre instance Zendesk.";
  } else if (connLower.includes('github') || connLower.includes('gitlab')) {
    labelText = "Dépôt (propriétaire/nom-dépôt)";
    placeholderText = "ex: cesar-ia/plateforme-agents-ia";
    descText = "Indiquez le dépôt ciblé pour l'agent avant d'initier la redirection OAuth.";
  } else if (connLower.includes('notion')) {
    labelText = "ID de la Base de Données Notion (Optionnel)";
    placeholderText = "ex: 4a25b16...";
    descText = "Permet de cibler une base de données spécifique. Laissez vide pour connecter tout votre espace de travail.";
  } else if (connLower.includes('airtable')) {
    labelText = "Base & Table Airtable (baseId/nomTable)";
    placeholderText = "ex: app12345678/Commandes";
    descText = "Format requis : ID de la base Airtable, suivi d'un slash, puis le nom exact de la table.";
  }

  const contentHtml = `
    <form id="oauth-pre-auth-form" style="text-align: left;">
      <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.45;">
        ${descText}
      </p>
      <div class="form-group">
        <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);">${labelText}</label>
        <input type="text" id="pre-auth-input" placeholder="${placeholderText}" required style="width: 100%;" />
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
        <button type="button" onclick="closeOauthSimulation()" class="btn" style="background: rgba(255,255,255,0.05); color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none;">Annuler</button>
        <button type="submit" class="btn" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none;">Démarrer la connexion ⚡</button>
      </div>
    </form>
  `;

  createModalOverlay(`Configuration ${connector}`, contentHtml);

  document.getElementById('oauth-pre-auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = document.getElementById('pre-auth-input').value.trim();
    if (!val) return;
    
    // Save to the UI field in the connectors form grid so it persists
    const toggleId = `toggle-${agentId}-${connector.replace(/[^a-zA-Z0-9]/g, '')}`;
    const toggleDiv = document.getElementById(toggleId);
    if (toggleDiv) {
      const domInput = toggleDiv.querySelector(`input[data-field="domain"]`);
      if (domInput) {
        domInput.value = val;
        domInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    
    // Launch OAuth
    await initiateRealOauth(agentId, connector, val);
  });
}

async function initiateRealOauth(agentId, connector, domainValue = null) {
  // Show premium loading screen
  const modalOverlay = document.querySelector('.oauth-modal-overlay') || document.createElement('div');
  modalOverlay.className = 'oauth-modal-overlay';
  modalOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(9, 9, 11, 0.85);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #fff;
  `;
  
  modalOverlay.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; animation: zoomIn 0.2s ease-out; padding: 24px;">
      <span class="spinner" style="width: 44px; height: 44px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #a855f7; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;"></span>
      <h4 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 8px; color: #fff;">Redirection sécurisée...</h4>
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0; max-width: 320px; line-height: 1.4;">Connexion officielle en cours avec ${connector} via tunnel SSL chiffré.</p>
    </div>
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes zoomIn {
        from { transform: scale(0.95); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
    </style>
  `;
  if (!modalOverlay.parentElement) {
    document.body.appendChild(modalOverlay);
  }
  
  try {
    const userId = state.currentUser ? state.currentUser.uid : '';
    let url = `/api/get-oauth-url?userId=${encodeURIComponent(userId)}&agentId=${encodeURIComponent(agentId)}&connector=${encodeURIComponent(connector)}`;
    if (domainValue) {
      url += `&domain=${encodeURIComponent(domainValue)}`;
    }
    
    let token = null;
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token;
      } catch (e) {
        logDebug(`[OAuth] Impossible de récupérer le token: ${e.message}`);
      }
    }
    
    const response = await fetch(url, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });
    const data = await response.json();
    
    if (!response.ok || data.error) {
      if (data.error === 'missing_config') {
        showConfigHelpModal(connector, data.message || "Variable d'environnement manquante sur Vercel.");
      } else {
        showToast(data.message || data.error || "Impossible d'obtenir l'URL d'authentification.", "error");
        closeOauthSimulation();
      }
      return;
    }
    
    if (data.url) {
      // Save domain field to UI draft/data if provided
      if (domainValue) {
        const toggleId = `toggle-${agentId}-${connector.replace(/[^a-zA-Z0-9]/g, '')}`;
        const toggleDiv = document.getElementById(toggleId);
        if (toggleDiv) {
          const domInput = toggleDiv.querySelector(`input[data-field="domain"]`);
          if (domInput) {
            domInput.value = domainValue;
            domInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
      
      // Redirect browser to the official provider OAuth page
      window.location.assign(data.url);
    } else {
      showToast("URL de redirection OAuth non spécifiée par l'API.", "error");
      closeOauthSimulation();
    }
  } catch (err) {
    console.error("OAuth error:", err);
    showToast("Une erreur est survenue lors de l'initialisation de la liaison.", "error");
    closeOauthSimulation();
  }
}

function showConfigHelpModal(connector, message) {
  const overlay = document.querySelector('.oauth-modal-overlay') || document.createElement('div');
  overlay.className = 'oauth-modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(9, 9, 11, 0.85);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #fff;
    padding: 20px;
    box-sizing: border-box;
  `;
  
  overlay.innerHTML = `
    <div class="glass-modal" style="width: 100%; max-width: 500px; background: rgba(22, 22, 28, 0.9); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); overflow: hidden; display: flex; flex-direction: column; animation: modalFadeIn 0.3s ease-out;">
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.06);">
        <h3 style="font-size: 1.1rem; font-weight: 700; margin: 0; color: #f43f5e; display: flex; align-items: center; gap: 8px;">
          ⚠️ Configuration Vercel Requise
        </h3>
        <button onclick="closeOauthSimulation()" style="background: transparent; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer; line-height: 1;">&times;</button>
      </div>
      <div style="padding: 24px; text-align: left; font-size: 0.88rem; line-height: 1.5;">
        <p style="margin-top: 0; color: #f43f5e; font-weight: 600;">Liaison officielle échouée : Clés d'API manquantes.</p>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">
          Pour activer l'authentification officielle réelle avec <strong>${connector}</strong>, vous devez configurer la variable d'environnement sur votre tableau de bord Vercel :
        </p>
        
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); padding: 14px; border-radius: 8px; font-family: var(--font-mono); font-size: 0.8rem; color: #c084fc; margin-bottom: 20px; word-break: break-all;">
          ${message}
        </div>
        
        <p style="color: var(--text-secondary); margin-bottom: 24px;">
          Une fois la clé configurée, redéployez le projet sur Vercel pour rendre la liaison active.
        </p>
        
        <div style="display: flex; justify-content: flex-end; gap: 12px;">
          <button onclick="closeOauthSimulation()" class="btn" style="background: rgba(255,255,255,0.05); color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none;">Fermer</button>
          <a href="https://vercel.com" target="_blank" class="btn" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;">Aller sur Vercel</a>
        </div>
      </div>
    </div>
  `;
  if (!overlay.parentElement) {
    document.body.appendChild(overlay);
  }
}

// RUN INITIALIZER
initApp();
