import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Détecte si des clés temporaires ou vides sont utilisées
export const isMock = !supabaseUrl || 
  !supabaseAnonKey || 
  supabaseUrl.includes('YOUR_SUPABASE_PROJECT_URL') || 
  supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY');

if (isMock) {
  console.warn(
    "César-IA Warning : Les variables de configuration Supabase sont manquantes ou fictives. " +
    "L'application fonctionne en mode de démonstration locale (en mémoire / localStorage)."
  );
}

export const supabase = isMock 
  ? null 
  : createClient(supabaseUrl, supabaseAnonKey);
