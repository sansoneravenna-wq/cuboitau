// Configuración del sitio. Estos dos datos son públicos por diseño (Supabase → Project Settings → API).
// La clave que va acá es la "anon" / "publishable". Nunca pegues acá la clave "service_role" ni la de Resend.
window.CUBO_CONFIG = {
  supabaseUrl: "https://lltxogoaqamcpvlanlor.supabase.co",
  supabaseAnonKey: "sb_publishable_o1Zzbt-bTDlJ4SjPcheFfQ_xVz8ifFx",
  // Tamaño de la etiqueta del gafete, en milímetros (ancho × alto)
  label: { w: 90, h: 55 }
};
