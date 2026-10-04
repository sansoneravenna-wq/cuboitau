// Configuración del sitio. Estos dos datos son públicos por diseño (Supabase → Project Settings → API).
// La clave que va acá es la "anon" / "publishable". Nunca pegues acá la clave "service_role" ni la de Resend.
window.CUBO_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "PEGAR-ACA-LA-CLAVE-ANON",
  // Tamaño de la etiqueta del gafete, en milímetros (ancho × alto)
  label: { w: 90, h: 55 }
};
