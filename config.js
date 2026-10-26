// Configuración del sitio. Estos dos datos son públicos por diseño (Supabase → Project Settings → API).
// La clave que va acá es la "anon" / "publishable". Nunca pegues acá la clave "service_role" ni la de Resend.
window.CUBO_CONFIG = {
  supabaseUrl: "https://lltxogoaqamcpvlanlor.supabase.co",
  supabaseAnonKey: "sb_publishable_o1Zzbt-bTDlJ4SjPcheFfQ_xVz8ifFx",
  // Etiqueta del gafete, en milímetros: w = largo, h = alto del diseño.
  // rollo = ancho del rollo de la impresora. Si es menor que w, la etiqueta se imprime girada a lo largo del rollo.
  // Papel que acepta la Brother QL-800 con el rollo DK-22251: "29 x 90 mm" (DC03). La etiqueta de 90 x 29 se imprime girada.
  label: { w: 90, h: 29, rollo: 29 }
};
