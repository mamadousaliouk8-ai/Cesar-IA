import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Force l'application à être en production réelle en permanence (pas de simulation)
export const isMock = false;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
