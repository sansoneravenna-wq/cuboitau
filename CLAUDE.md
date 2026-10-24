# Contexto del proyecto (para Claude)

Plataforma de inscripciones de marca blanca para **Cubo Itaú** (Montevideo), desarrollada por **RedTickets**. Responder siempre en español rioplatense, con trato de vos y sin jerga técnica innecesaria: quien pide los cambios no es programador.

## Cómo está armado

- Sitio estático sin paso de compilación: `index.html`, `styles.css`, `app.js` (todo el comportamiento) y `config.js` (conexión a Supabase y tamaño de etiqueta). Librerías copiadas en `vendor/`.
- Publicación: **Cloudflare Pages** conectado a la rama `main`. Cada push a `main` se publica solo en https://cuboeventos.uy/ en uno o dos minutos.
- Base de datos, permisos y envío de correos: **Supabase** (proyecto `lltxogoaqamcpvlanlor`). Todo el esquema está en `supabase/schema.sql`, que se puede volver a correr sin perder datos. Los correos salen por **Resend** con el dominio `cuboeventos.uy`, llamados desde la base con `pg_net`.
- El esquema `priv` guarda funciones internas que el sitio no puede llamar. Lo que el sitio usa son funciones `public.*` con verificación de permisos adentro.

## Rutas del sitio

- `#/` agenda · `#/e/<slug>` evento e inscripción · `#/entrada/<código>` entrada con QR · `#/certificado/<código>` certificado
- `#/admin` panel (usuarios en la tabla `admins`, organización `Cubo Itaú` o `RedTickets`)
- `#/totem` tótem: agenda con inscripción y acreditación automática del evento en curso (usuarios en la tabla `kiosks`). Guía en `TOTEM.md`.

## Al hacer cambios

1. Si el cambio toca la base, editar `supabase/schema.sql` manteniéndolo re-ejecutable (`create or replace`, `if not exists`, `drop policy if exists`) y avisar que hay que pegarlo de nuevo en Supabase → SQL Editor y después correr `notify pgrst, 'reload schema';`.
2. Probar antes de subir: `node --check app.js` y, si se puede, el flujo con datos simulados.
3. Subir a `main` con un mensaje de commit en español. Contarle a la persona qué cambió en la pantalla, no en el código.
4. Nunca poner en el repositorio la clave `service_role` de Supabase ni la de Resend (la de Resend se carga desde el panel, en Correos).

## Pendientes conocidos

- Pase para Apple Wallet y Google Wallet (faltan las cuentas de emisor).
- Texto legal del consentimiento, a revisar por Cubo Itaú.
- Planes pagos de Supabase y Resend antes del piloto del 24 al 26 de noviembre de 2026.
