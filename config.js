// Configuración del sitio. Estos dos datos son públicos por diseño (Supabase → Project Settings → API).
// La clave que va acá es la "anon" / "publishable". Nunca pegues acá la clave "service_role" ni la de Resend.
window.CUBO_CONFIG = {
  supabaseUrl: "https://lltxogoaqamcpvlanlor.supabase.co",
  supabaseAnonKey: "sb_publishable_o1Zzbt-bTDlJ4SjPcheFfQ_xVz8ifFx",
  // Etiqueta del gafete, en milímetros: w = largo, h = alto del diseño.
  // rollo = ancho del rollo de la impresora. Si es menor que w, la etiqueta se imprime girada a lo largo del rollo.
  // Rollo actual: Brother DK-22251, continuo de 62 mm. Sin "rollo": se imprime como al principio (página 100 x 62), que es como funcionó.
  label: { w: 100, h: 62 }
};
