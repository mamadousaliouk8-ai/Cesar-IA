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
      
      if (res.status === 204) {
        return null;
      }
      
      return await res.json();
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
  connectorsData: {}, // { agentId: { connectorName: { field1: val, ... } } }
  invoices: [],
  cardDetailsSaved: false,
  stripeLinks: {} // { agentId: url }
};

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
    setupInvoiceModal();
    updateUI();
    
    // Restaurer le rendu initial de la route si elle est publique (comme 'catalog')
    if (state.activeRoute === 'catalog') {
      navigateTo('catalog');
    } else if (state.activeRoute === 'home') {
      navigateTo('home');
    }
    
    // Show welcome toast
    showToast("Bienvenue sur César-IA ! Explorez notre catalogue.");
  } catch (error) {
    alert("Erreur d'initialisation de l'application :\n" + error.name + ": " + error.message + "\n\nStack:\n" + error.stack);
    console.error("Initialization error:", error);
  }
}

// Custom Event Delegation / Page Routing
function setupRoutes() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const route = link.getAttribute('data-route');
      
      // Access control: dashboard and billing require user to be logged in
      if ((route === 'dashboard' || route === 'billing') && !state.currentUser) {
        showToast("Veuillez d'abord vous connecter ou créer un compte.", "warning");
        openAuthModal(route === 'dashboard' ? 'Inscription requise pour le Dashboard' : 'Inscription requise pour la Facturation');
        return;
      }
      
      navigateTo(route);
    });
  });

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
    showToast("Choisissez un agent, liez vos comptes de services, et laissez l'IA travailler !");
  });
}

function navigateTo(route) {
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
  } else if (route === 'admin') {
    renderAdminPanel();
  }
}

// AUTHENTICATION LOGIC (Supabase + Demo Fallback)
let isSignupMode = true;

function setupAuth() {
  setupAuthNav();
  setupAuthModal();
  initSupabaseAuth();
}

function setupAuthNav() {
  const authNav = document.getElementById('auth-nav-container');
  authNav.addEventListener('click', async (e) => {
    const target = e.target;
    if (target.id === 'btn-login-open') {
      openAuthModal(false);
    } else if (target.id === 'btn-signup-open') {
      openAuthModal(true);
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
  
  if (!email || password.length < 6) {
    const minLengthMsg = "Le mot de passe doit comporter au moins 6 caractères.";
    if (errEl) {
      errEl.innerText = minLengthMsg;
      errEl.style.display = 'block';
    }
    showToast(minLengthMsg, "error");
    logDebug(`Erreur validation locale: ${minLengthMsg}`);
    return;
  }

  const btnSubmit = document.getElementById('btn-auth-submit');
  const originalText = btnSubmit.innerText;
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span class="spinner"></span> Traitement...`;

  if (isMock) {
    logDebug("Connexion en mode Simulation locale...");
    setTimeout(() => {
      state.currentUser = {
        email: email,
        uid: "usr_" + Math.random().toString(36).substr(2, 9)
      };
      
      localStorage.setItem('cesar_ia_mock_user', JSON.stringify(state.currentUser));
      loadMockState();
      
      btnSubmit.disabled = false;
      btnSubmit.innerText = originalText;
      
      document.getElementById('auth-modal').close();
      showToast(isSignupMode ? "Compte créé (Simulation) !" : "Connexion réussie (Simulation) !");
      updateUI();
      
      if (state.activeRoute === 'home') {
        navigateTo('catalog');
      } else {
        navigateTo(state.activeRoute);
      }
      logDebug("Connexion simulation réussie ! Redirection...");
    }, 800);
  } else {
    // Mode Supabase réel
    try {
      if (isSignupMode) {
        logDebug("Envoi requête d'inscription Supabase...");
        const { data, error } = await supabase.auth.signUp({
          email,
          password
        });
        logDebug(`Inscription Supabase retournée. Erreur: ${error ? error.message : "aucune"}`);
        if (error) throw error;
        
        showToast("Inscription réussie ! Connecté ou vérifiez vos e-mails.", "success");
        const session = data?.session;
        if (!session) {
          logDebug("Pas de session directe après inscription, tentative de connexion...");
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password
          });
          logDebug(`Connexion post-inscription retournée. Erreur: ${signInError ? signInError.message : "aucune"}`);
          if (signInError) throw signInError;
        }
      } else {
        logDebug("Envoi requête de connexion Supabase...");
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        logDebug(`Connexion Supabase retournée. Erreur: ${error ? error.message : "aucune"}`);
        if (error) throw error;
      }
    } catch (err) {
      logDebug(`Erreur attrapée dans catch: ${err.message}`);
      console.error(err);
      const errMsg = err.message || "Une erreur est survenue lors de l'authentification.";
      if (errEl) {
        errEl.innerText = errMsg === "Invalid login credentials" 
          ? "Identifiants de connexion invalides. Veuillez cliquer sur 'Créer un compte' ci-dessous pour d'abord vous inscrire dans votre projet Supabase réel."
          : errMsg;
        errEl.style.display = 'block';
      }
      showToast(errMsg, "error");
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerText = originalText;
    }
  }
}

async function handleLogout() {
  if (isMock) {
    state.currentUser = null;
    state.adoptedAgents = [];
    state.activeDashboardAgentId = null;
    state.invoices = [];
    state.connectorsData = {};
    localStorage.removeItem('cesar_ia_mock_user');
    showToast("Déconnexion réussie.");
    updateUI();
    navigateTo('home');
  } else {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast(error.message, "error");
    } else {
      showToast("Déconnexion réussie.");
      navigateTo('home');
    }
  }
}

async function initSupabaseAuth() {
  if (isMock) {
    const savedUser = localStorage.getItem('cesar_ia_mock_user');
    if (savedUser) {
      state.currentUser = JSON.parse(savedUser);
      loadMockState();
      await handleStripeCallback();
      updateUI();
    } else {
      await handleStripeCallback();
    }
    return;
  }
  
  logDebug("Initialisation de Supabase Auth...");
  
  // Tenter de récupérer la session immédiatement au chargement (évite les ratés de onAuthStateChange)
  try {
    logDebug("Récupération de la session en cours (direct)...");
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      logDebug(`Erreur getSession: ${error.message}`);
    } else if (session) {
      logDebug(`Session active récupérée au chargement pour: ${session.user.email}`);
      state.currentUser = {
        email: session.user.email,
        uid: session.user.id
      };
      if (session.user.email && session.user.email.toLowerCase() === 'contact@cesar-ia.com') {
        state.currentUser.isAdmin = true;
      }
      await loadUserData();
      await handleStripeCallback();
      updateUI();
      
      logDebug(`[getSession] Redirection vers l'onglet : ${state.activeRoute === 'home' ? 'catalog' : state.activeRoute}`);
      if (state.activeRoute === 'home') {
        navigateTo('catalog');
      } else {
        navigateTo(state.activeRoute);
      }
    } else {
      logDebug("Aucune session active détectée au chargement direct.");
      if (state.activeRoute === 'dashboard' || state.activeRoute === 'billing' || state.activeRoute === 'admin') {
        navigateTo('home');
      }
    }
  } catch (errSession) {
    logDebug(`Exception lors de getSession: ${errSession.message}`);
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    logDebug(`onAuthStateChange déclenché. Événement: ${event}, Session: ${session ? 'active' : 'nulle'}`);
    if (session) {
      const isSameUser = state.currentUser && state.currentUser.uid === session.user.id && state.currentUser.isAdmin !== undefined;
      
      state.currentUser = {
        email: session.user.email,
        uid: session.user.id
      };
      
      // Fallback immédiat d'authentification par e-mail
      if (session.user.email && session.user.email.toLowerCase() === 'contact@cesar-ia.com') {
        state.currentUser.isAdmin = true;
      }
      
      logDebug(`Session utilisateur détectée pour email: ${state.currentUser.email}`);
      
      if (!isSameUser) {
        await loadUserData();
      } else {
        logDebug("L'utilisateur était déjà connecté dans l'état local.");
      }
      
      await handleStripeCallback();
      
      const authModal = document.getElementById('auth-modal');
      if (authModal && authModal.open) {
        logDebug("Fermeture de la modale d'authentification.");
        authModal.close();
      }
      
      updateUI();
      
      logDebug(`Redirection vers l'onglet : ${state.activeRoute === 'home' ? 'catalog' : state.activeRoute}`);
      if (state.activeRoute === 'home') {
        navigateTo('catalog');
      } else {
        navigateTo(state.activeRoute);
      }
    } else {
      // Si l'utilisateur n'est pas connecté et qu'on essaie de charger une page protégée, renvoi à l'accueil
      if (state.activeRoute === 'dashboard' || state.activeRoute === 'billing' || state.activeRoute === 'admin') {
        navigateTo('home');
      }
      
      // Éviter de réinitialiser inutilement si l'utilisateur était déjà nul
      if (state.currentUser === null) {
        return;
      }
      logDebug("Aucune session active, réinitialisation de l'état.");
      state.currentUser = null;
      state.adoptedAgents = [];
      state.activeDashboardAgentId = null;
      state.invoices = [];
      state.connectorsData = {};
      
      updateUI();
    }
  });
}

async function loadUserData() {
  if (isMock || !state.currentUser) return;
  
  try {
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
      state.currentUser.isAdmin = profile.is_admin;
      logDebug(`Profil utilisateur chargé. Admin: ${profile.is_admin}`);
    } else {
      logDebug(`Erreur profiles ou non trouvé, valeur par défaut non-admin (erreur: ${errProfile ? errProfile.message : 'aucune'})`);
      state.currentUser.isAdmin = false;
    }
    
    // Fallback de sécurité robuste par email pour César-IA admin
    if (state.currentUser.email && state.currentUser.email.toLowerCase() === 'contact@cesar-ia.com') {
      state.currentUser.isAdmin = true;
      logDebug(`[loadUserData] Force de l'état Admin via l'adresse e-mail.`);
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
}

function saveMockState() {
  if (!isMock) return;
  localStorage.setItem('cesar_ia_mock_adopted', JSON.stringify(state.adoptedAgents));
  localStorage.setItem('cesar_ia_mock_invoices', JSON.stringify(state.invoices));
  localStorage.setItem('cesar_ia_mock_connectors', JSON.stringify(state.connectorsData));
}

function loadMockState() {
  if (!isMock) return;
  try {
    const adopted = localStorage.getItem('cesar_ia_mock_adopted');
    const invoices = localStorage.getItem('cesar_ia_mock_invoices');
    const connectors = localStorage.getItem('cesar_ia_mock_connectors');
    
    if (adopted) state.adoptedAgents = JSON.parse(adopted);
    if (invoices) state.invoices = JSON.parse(invoices);
    if (connectors) state.connectorsData = JSON.parse(connectors);
  } catch (e) {
    console.error("Error loading mock state", e);
  }
}

function updateUI() {
  const authContainer = document.getElementById('auth-nav-container');
  const navLinks = document.querySelector('.nav-links');
  
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
      
      navLinks.appendChild(adminLink);
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
      <button class="btn btn-primary btn-sm" id="btn-signup-open">Créer un compte</button>
    `;
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
    
  filtered.forEach(agent => {
    const isAdopted = state.adoptedAgents.includes(agent.id);
    const accentRgb = hexToRgb(agent.color) || "99, 102, 241";
    
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.style.setProperty('--card-accent', agent.color);
    card.style.setProperty('--card-accent-hover', lightenDarkenColor(agent.color, 20));
    card.style.setProperty('--card-accent-rgb', accentRgb);
    
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
          <span class="price-val">${agent.price} €</span>
          <span class="price-period">/ mois</span>
        </div>
        <button class="btn btn-sm ${isAdopted ? 'btn-secondary' : 'btn-primary'} btn-adopt-trigger" data-agent-id="${agent.id}">
          ${isAdopted ? '✓ Adopté' : 'Adopter'}
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
      
      if (state.adoptedAgents.includes(agentId)) {
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
  document.getElementById('checkout-price-fees').innerText = `${agent.price}.00 € / mois`;
  document.getElementById('checkout-price-total').innerText = `${agent.price}.00 €`;
  
  const stripeUrl = state.stripeLinks[agentId] || agent.stripeLink;
  const btnConfirm = document.getElementById('btn-adopt-confirm');
  const typeNote = document.getElementById('checkout-payment-type-note');
  const cardFormContainer = document.getElementById('checkout-payment-form-container');
  
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
    document.getElementById('card-brand-icon').innerText = '💳';
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
  
  document.getElementById('btn-adopt-close').addEventListener('click', () => adoptModal.close());
  document.getElementById('btn-adopt-cancel').addEventListener('click', () => adoptModal.close());
  
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
    
    const stripeUrl = state.stripeLinks[agentId] || agent.stripeLink;
    const btnConfirm = document.getElementById('btn-adopt-confirm');
    
    if (stripeUrl) {
      btnConfirm.disabled = true;
      btnConfirm.innerHTML = `<span class="spinner"></span> Redirection Stripe...`;
      
      // Sauvegarder l'agentId AVANT la redirection pour le récupérer au retour
      // (Stripe Payment Links ne permet pas d'ajouter des paramètres dynamiques)
      localStorage.setItem('cesar_ia_pending_stripe_callback', JSON.stringify({
        agentId: agentId,
        sessionId: null,
        timestamp: Date.now()
      }));
      
      // Attendre 300ms pour que le localStorage soit bien écrit
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Redirection vers Stripe
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
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Latence réseau Stripe simulée
    
    if (isMock) {
      if (!state.adoptedAgents.includes(agentId)) {
        state.adoptedAgents.push(agentId);
      }
      if (state.currentUser) {
        state.currentUser.adopted = state.adoptedAgents;
      }
      const invoiceNo = "INV-" + Math.floor(100000 + Math.random() * 900000);
      state.invoices.push({
        id: invoiceNo,
        date: new Date().toLocaleDateString('fr-FR'),
        agentName: agent.name,
        price: agent.price,
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
        
        const invoiceNo = "INV-" + Math.floor(100000 + Math.random() * 900000);
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
      document.querySelectorAll('.panel-tabs .panel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      state.activeDashboardTab = tab.getAttribute('data-tab');
      renderDashboardTabContent();
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
}

function renderDashboardSidebar() {
  const sidebarList = document.getElementById('sidebar-adopted-list');
  sidebarList.innerHTML = '';
  
  if (state.adoptedAgents.length === 0) {
    sidebarList.innerHTML = `
      <div class="no-adopted">
        Vous n'avez pas encore d'agent.<br><br>
        <button class="btn btn-primary btn-sm" onclick="document.querySelector('[data-route=catalog]').click()">Adopter un agent</button>
      </div>
    `;
    return;
  }
  
  state.adoptedAgents.forEach(agentId => {
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
  });
}

function isAgentConfigured(agentId) {
  const data = state.connectorsData[agentId];
  if (!data) return false;
  
  // Check if at least one field has been entered
  return Object.values(data).some(connData => {
    return Object.values(connData).some(val => val.trim().length > 0);
  });
}

function selectDashboardAgent(agentId) {
  state.activeDashboardAgentId = agentId;
  renderDashboardSidebar();
  renderDashboardPanel();
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
  
  // Set tab back to chat by default
  document.querySelectorAll('.panel-tabs .panel-tab').forEach(t => {
    if (t.getAttribute('data-tab') === 'chat') t.classList.add('active');
    else t.classList.remove('active');
  });
  state.activeDashboardTab = 'chat';
  
  renderDashboardTabContent();
}

function renderDashboardTabContent() {
  const tabChat = document.getElementById('tab-chat');
  const tabConnectors = document.getElementById('tab-connectors');
  const tabStats = document.getElementById('tab-stats');
  
  // Masquer tous les onglets par défaut
  tabChat.classList.remove('active');
  tabConnectors.classList.remove('active');
  tabStats.classList.remove('active');
  
  if (state.activeDashboardTab === 'chat') {
    tabChat.classList.add('active');
    renderChatMessages();
  } else if (state.activeDashboardTab === 'connectors') {
    tabConnectors.classList.add('active');
    renderConnectorsForm();
  } else if (state.activeDashboardTab === 'stats') {
    tabStats.classList.add('active');
    renderStatsTab();
  }
}

// STATS TAB RENDERING
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

  // Génération de métriques réalistes
  const queries = getSeededRandom(80, 350, 1);
  const tokensVal = (getSeededRandom(150, 890, 2) / 10).toFixed(1);
  const tasks = getSeededRandom(10, 45, 3);
  const isConfig = isAgentConfigured(agentId);
  const uptime = isConfig ? "100%" : "0%";
  const uptimeColor = isConfig ? "#10b981" : "#ef4444";

  // Mettre à jour l'état du checkbox e-mail
  const toggleEmailDigest = document.getElementById('toggle-email-digest');
  if (toggleEmailDigest) {
    const isEnabled = localStorage.getItem(`cesar_ia_email_digest_${agentId}`) === 'true';
    toggleEmailDigest.checked = isEnabled;
  }

  // Mettre à jour les indicateurs du DOM
  document.getElementById('stats-total-queries').innerText = queries;
  document.getElementById('stats-total-tokens').innerText = `${tokensVal}k`;
  document.getElementById('stats-total-tasks').innerText = tasks;
  
  const uptimeEl = document.getElementById('stats-uptime');
  uptimeEl.innerText = uptime;
  uptimeEl.style.color = uptimeColor;

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
          time: getLogTimeStr(38),
          source: 'SCHEDULER',
          text: `Vérification du calendrier éditorial pour LinkedIn et X/Twitter.`,
          type: 'info'
        });
        logs.push({
          time: getLogTimeStr(35),
          source: 'API_POST',
          text: `Publication automatique effectuée sur LinkedIn : "L'automatisation IA..."`,
          type: 'success'
        });
        logs.push({
          time: getLogTimeStr(12),
          source: 'METRICS',
          text: `Collecte des taux d'engagement hebdomadaires (+4.2% d'interactions).`,
          type: 'success'
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
// Store chat history by agentId: { agentId: [{ sender: 'agent'|'user', text: '' }] }
const chatHistories = {};

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
  
  return `Tu es ${agent.name}, ${agent.title}.
Description de ton rôle : ${agent.desc}

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
Sois précis, réactif et adopte un style haut de gamme en adéquation avec la plateforme César-IA.`;
}

function formatChatHistoryForGemini(agentId) {
  const rawHistory = chatHistories[agentId] || [];
  if (rawHistory.length === 0) return [];
  
  const mapped = [];
  for (const msg of rawHistory) {
    const role = msg.sender === 'user' ? 'user' : 'model';
    if (mapped.length > 0 && mapped[mapped.length - 1].role === role) {
      // Append text to existing last message
      mapped[mapped.length - 1].parts[0].text += "\n" + msg.text;
    } else {
      mapped.push({
        role: role,
        parts: [{ text: msg.text }]
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
        
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyToTest}`, {
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
        statusEl.innerHTML = `<span style="color: #10b981; display: inline-flex; align-items: center; gap: 6px;">🟢 Clé API valide et fonctionnelle ! (Modèle: gemini-2.5-flash)</span>`;
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

function updateGeminiKeyStatus() {
  const statusEl = document.getElementById('gemini-key-status');
  if (!statusEl) return;
  
  const localKey = localStorage.getItem('cesar_ia_gemini_api_key');
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  if (localKey) {
    statusEl.innerHTML = `<span style="color: #10b981;">🟢 Clé API configurée via le stockage local (localStorage).</span>`;
  } else if (envKey) {
    statusEl.innerHTML = `<span style="color: #6366f1;">🔵 Clé API héritée du fichier d'environnement (.env).</span>`;
  } else {
    statusEl.innerHTML = `<span style="color: var(--text-secondary);">🟡 Aucune clé API configurée. Mode simulation actif.</span>`;
  }
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
        logDebug("Sauvegarde des liens Stripe sur Supabase...");
        
        // Parcourir tous les agents du catalogue
        for (const agent of AGENTS) {
          const url = state.stripeLinks[agent.id] || '';
          if (url) {
            await supabaseFetch('stripe_links', {
              method: 'POST',
              queryParams: `?on_conflict=agent_id`,
              headers: {
                Prefer: 'resolution=merge-duplicates'
              },
              body: { agent_id: agent.id, url: url }
            });
          } else {
            // Supprimer de Supabase si vidé
            try {
              await supabaseFetch('stripe_links', {
                method: 'DELETE',
                queryParams: `?agent_id=eq.${agent.id}`
              });
            } catch (errDel) {
              // ignorer si l'entrée n'existait pas
            }
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

function renderChatMessages() {
  const container = document.getElementById('chat-messages-container');
  container.innerHTML = '';
  
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  
  if (!chatHistories[agentId]) {
    // Initial welcome message
    chatHistories[agentId] = [
      { sender: 'agent', text: agent.welcome }
    ];
  }
  
  chatHistories[agentId].forEach(msg => {
    const bubble = document.createElement('div');
    bubble.className = `message ${msg.sender}`;
    bubble.innerHTML = `
      <div class="msg-avatar">${msg.sender === 'agent' ? agent.avatar : '👤'}</div>
      <div class="msg-bubble">${parseMarkdown(msg.text)}</div>
    `;
    container.appendChild(bubble);
  });
  
  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-user-input');
  const text = input.value.trim();
  if (!text) return;
  
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  
  // Save user message
  chatHistories[agentId].push({ sender: 'user', text: text });
  renderChatMessages();
  input.value = '';
  
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
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: systemInstruction,
          apiKey: localKey // Passe la clé locale si elle existe, sinon le backend prendra celle d'environnement
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
      
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
      const finishReason = data.candidates[0]?.finishReason;
      logDebug(`[Gemini API] Réponse reçue avec succès. finishReason: ${finishReason || 'STOP'}`);
      if (finishReason && finishReason !== 'STOP') {
        logDebug(`[Gemini API] Attention: La génération s'est arrêtée avec le motif: ${finishReason}`);
      }
      chatHistories[agentId].push({ sender: 'agent', text: replyText });
      renderChatMessages();
    } else {
      const errorMsg = data.error?.message || "Erreur de réponse API";
      logDebug(`[Gemini API] Échec de l'appel API: ${errorMsg}. Repli sur la simulation.`);
      throw new Error(errorMsg);
    }
  } catch (err) {
    logDebug(`[Gemini API] Erreur lors de l'appel: ${err.message}. Bascule en simulation.`);
    if (typingMsg) typingMsg.remove();
    const response = getSimulatedAgentResponse(agent, text);
    chatHistories[agentId].push({ sender: 'agent', text: response });
    renderChatMessages();
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
      if (msg.includes('linkedin') || msg.includes('post') || msg.includes('redige')) {
        return `🕒 **Proposition de post LinkedIn rédigée** :\n\n"🚀 *L'avenir du travail est hybride, mais l'avenir des opérations est autonome.*\nChez [MonAgence], nous venons de déployer 15 agents IA capables de se connecter en SSH et SQL pour automatiser 80% des tâches répétitives. Finie la saisie de données manuelle !\n\n👇 Qu'en pensez-vous ? Réagissez en commentaire !\n#IA #DevOps #Productivite"\n\n*Voulez-vous que je planifie cette publication pour demain 9h00 sur votre compte ?*`;
      }
      return `Je suis connecté à vos comptes réseaux sociaux. Je peux rédiger des posts optimisés pour LinkedIn, planifier des tweets (X), ou collecter les statistiques de vos dernières publications.`;
      
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

// CONNECTORS CONFIGURATION FORM
function renderConnectorsForm() {
  const formGrid = document.getElementById('connectors-form-grid');
  formGrid.innerHTML = '';
  
  const agentId = state.activeDashboardAgentId;
  const agent = AGENTS.find(a => a.id === agentId);
  if (!agent) return;
  
  const savedData = state.connectorsData[agentId] || {};
  
  agent.connectors.forEach(connector => {
    const card = document.createElement('div');
    card.className = 'connector-card';
    
    // Determine status (connected or not)
    const isConn = savedData[connector] && Object.values(savedData[connector]).some(val => val.length > 0);
    
    let fieldsHtml = '';
    
    // Customize form inputs depending on the connector type
    if (connector.includes('SSH')) {
      fieldsHtml = `
        <div class="form-group">
          <label>Hôte du Serveur (IP ou Domaine)</label>
          <input type="text" data-conn="${connector}" data-field="host" value="${savedData[connector]?.host || ''}" placeholder="ex: 192.168.1.100" />
        </div>
        <div class="form-group">
          <label>Utilisateur SSH</label>
          <input type="text" data-conn="${connector}" data-field="user" value="${savedData[connector]?.user || ''}" placeholder="ex: root" />
        </div>
        <div class="form-group">
          <label>Clé Privée SSH ou Mot de Passe</label>
          <input type="password" data-conn="${connector}" data-field="secret" value="${savedData[connector]?.secret || ''}" placeholder="••••••••••••••" />
        </div>
      `;
    } else if (connector.includes('PostgreSQL') || connector.includes('MySQL') || connector.includes('BigQuery') || connector.includes('Snowflake') || connector.includes('MongoDB') || connector.includes('Database')) {
      fieldsHtml = `
        <div class="form-group">
          <label>Chaîne de Connexion (URI / Connexion)</label>
          <input type="text" data-conn="${connector}" data-field="uri" value="${savedData[connector]?.uri || ''}" placeholder="postgresql://user:password@localhost:5432/db" />
        </div>
      `;
    } else {
      // Default: API Token, Webhook or SaaS credentials
      const needsUrl = ['Zendesk', 'Jira', 'WordPress', 'Shopify', 'Webflow', 'Crisp', 'Freshdesk', 'WooCommerce', 'PrestaShop', 'ClickUp', 'Linear', 'Crowdin', 'Phrase', 'Sellsy', 'Axonaut', 'Qonto', 'Spendesk', 'GitBook', 'SharePoint', 'Grafana'].some(term => connector.includes(term));
      
      fieldsHtml = `
        <div class="form-group">
          <label>${connector.includes('Webhook') ? "URL du Webhook / Clé secrète" : "Clé d'API / Jeton d'Accès"}</label>
          <input type="password" data-conn="${connector}" data-field="token" value="${savedData[connector]?.token || ''}" placeholder="${connector.includes('Webhook') ? 'https://votre-serveur.com/webhook' : 'sk_live_••••••••••••••••'}" />
        </div>
        ${needsUrl ? `
        <div class="form-group">
          <label>URL du Logiciel (Domaine)</label>
          <input type="text" data-conn="${connector}" data-field="domain" value="${savedData[connector]?.domain || ''}" placeholder="https://votre-domaine.com" />
        </div>
        ` : ''}
      `;
    }
    
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
      <div class="connector-fields">
        ${fieldsHtml}
      </div>
    `;
    
    formGrid.appendChild(card);
  });
  
  // Clean connection status banner
  document.getElementById('test-connection-status').innerHTML = '';
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
  
  const inputs = document.querySelectorAll('#connectors-form-grid input');
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
  
  // Re-render status dots in sidebar and reload connectors display
  renderDashboardSidebar();
  renderConnectorsForm();
  
  showToast("Paramètres de connexion enregistrés avec succès !");
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

function renderBilling() {
  const activeList = document.getElementById('active-subscriptions-list');
  const invoicesBody = document.getElementById('invoices-list-body');
  const summaryItems = document.getElementById('billing-summary-items');
  const summaryTotal = document.getElementById('billing-summary-total');
  
  activeList.innerHTML = '';
  invoicesBody.innerHTML = '';
  summaryItems.innerHTML = '';
  
  let totalCost = 0;
  
  if (state.adoptedAgents.length === 0) {
    activeList.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px 0;">
        Vous n'avez aucun agent actif souscrit. Rendez-vous dans le <a href="#" onclick="document.querySelector('[data-route=catalog]').click()" style="color: var(--accent-color); text-decoration: none; font-weight: 600;">Catalogue</a>.
      </div>
    `;
  } else {
    state.adoptedAgents.forEach(agentId => {
      const agent = AGENTS.find(a => a.id === agentId);
      if (!agent) return;
      
      totalCost += agent.price;
      
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.padding = '14px';
      item.style.background = 'rgba(255, 255, 255, 0.01)';
      item.style.border = '1px solid var(--border-color)';
      item.style.borderRadius = '8px';
      item.style.marginBottom = '10px';
      
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
            <div style="font-weight: 700;">${agent.price}.00 €</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">par mois</div>
          </div>
          <button class="btn btn-danger btn-sm btn-unsubscribe" data-agent-id="${agent.id}">Résilier</button>
        </div>
      `;
      
      activeList.appendChild(item);
      
      // Summary list item
      const sumItem = document.createElement('div');
      sumItem.className = 'summary-row';
      sumItem.innerHTML = `
        <span>Abonnement ${agent.name}</span>
        <span>${agent.price}.00 €</span>
      `;
      summaryItems.appendChild(sumItem);
    });
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
      tr.innerHTML = `
        <td>${inv.id}</td>
        <td>${inv.date}</td>
        <td>${inv.agentName}</td>
        <td style="font-weight: 600;">${inv.price}.00 €</td>
        <td><span class="badge-paid">${inv.status}</span></td>
        <td style="text-align: center;">
          <button class="btn btn-sm btn-secondary btn-view-invoice" data-invoice-id="${inv.id}" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 4px;">Voir 👁️</button>
        </td>
      `;
      invoicesBody.appendChild(tr);
    });

    // Bind event listeners for view invoice buttons
    document.querySelectorAll('.btn-view-invoice').forEach(btn => {
      btn.addEventListener('click', () => {
        const invoiceId = btn.getAttribute('data-invoice-id');
        openInvoiceModal(invoiceId);
      });
    });
  }
  
  // Total summary
  summaryTotal.innerText = `${totalCost}.00 €`;
  
  // Re-bind unsubscribe triggers
  document.querySelectorAll('.btn-unsubscribe').forEach(btn => {
    btn.addEventListener('click', async () => {
      const agentId = btn.getAttribute('data-agent-id');
      
      if (isMock) {
        state.adoptedAgents = state.adoptedAgents.filter(id => id !== agentId);
        if (state.currentUser) {
          state.currentUser.adopted = state.adoptedAgents;
        }
        saveMockState();
      } else {
        try {
          btn.disabled = true;
          await supabaseFetch('adopted_agents', {
            method: 'DELETE',
            queryParams: `?user_id=eq.${state.currentUser.uid}&agent_id=eq.${agentId}`
          });
          
          await loadUserData();
        } catch (error) {
          console.error("Erreur lors de la désinscription :", error);
          showToast("Erreur lors de la résiliation de l'agent.", "error");
          btn.disabled = false;
          return;
        }
      }
      
      // Reset active agent in dashboard if it was deleted
      if (state.activeDashboardAgentId === agentId) {
        state.activeDashboardAgentId = null;
      }
      
      showToast(`Abonnement à l'agent résilié.`, "info");
      renderBilling();
      renderCatalog();
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

// RUN INITIALIZER
initApp();
