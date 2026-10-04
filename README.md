# Cubo Itaú Eventos

Plataforma de inscripciones de marca blanca para Cubo Itaú, desarrollada por RedTickets.

- **Sitio**: páginas estáticas (este repositorio), publicadas con GitHub Pages.
- **Datos, ingreso de administradores y correos**: un proyecto de Supabase.
- **Envío de correos**: Resend, llamado desde la base de datos.

## Qué hace

| Requisito | Dónde está |
| --- | --- |
| Inscripción sujeta a aprobación | Página del evento → queda *pendiente* → Administrador → Inscripciones |
| Excel de asistencia en todo momento | Inscripciones → *Descargar Excel* (hojas: Asistieron, No asistieron, Todos) |
| Formulario a medida por evento | Administrador → Formulario |
| QR validable y etiqueta de gafete | Administrador → Check-in (cámara, lector USB o código escrito) |
| Registro de asistencia sin etiqueta | Check-in → *Registrar ingreso sin etiqueta* |
| Administradores de Cubo Itaú y RedTickets | Tabla `admins`, con la organización de cada usuario |
| Correos: pendiente, aprobación con QR y calendario, aviso al organizador | Administrador → Correos |

## Puesta en marcha

### 1. Base de datos (una vez)

1. En Supabase, abrí **SQL Editor**, pegá todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y tocá **Run**.
2. En **Authentication → Users → Add user**, creá el usuario administrador con email y contraseña (marcá *Auto Confirm User*).
3. De vuelta en **SQL Editor**, dale permiso de administrador (cambiá el email; la organización es `RedTickets` o `Cubo Itaú`):

   ```sql
   insert into public.admins (user_id, org)
   select id, 'RedTickets' from auth.users where email = 'tu@email.com';
   ```

4. Recomendado: en **Authentication → Sign In / Providers**, desactivá *Allow new users to sign up*. Registrarse no da permisos, pero así nadie crea cuentas de más.

### 2. Conectar el sitio

En **Project Settings → API** copiá la *Project URL* y la clave *anon / publishable* y pegalas en [`config.js`](config.js). Son datos públicos por diseño. **Nunca** pegues en el repositorio la clave `service_role` ni la de Resend.

### 3. Publicar

En GitHub: **Settings → Pages → Deploy from a branch → `main` / root**. El sitio queda en `https://sansoneravenna-wq.github.io/cuboitau/`.

### 4. Correos

1. Creá una cuenta en [resend.com](https://resend.com) y generá una *API key*.
2. En el sitio: **Administrador → Correos → Envío de correos**, pegá la clave y guardá. Queda guardada en la base, fuera del alcance del sitio público.
3. Tocá **Enviar correo de prueba**.

Sin dominio verificado, Resend solo entrega a la dirección con la que te registraste (alcanza para probar). Para escribirle a los asistentes hay que verificar un dominio en Resend y poner ese remitente en el panel, por ejemplo `Cubo Itaú Eventos <eventos@dominio.com>`.

## Cómo probar el flujo completo

1. Administrador → **Crear evento**, completar datos, armar el formulario y **Publicar**.
2. Abrir la página del evento en otra ventana e inscribirse.
3. Administrador → Inscripciones → **Aprobar**. Llega el correo con el QR.
4. Abrir **Ver mi entrada** desde el correo y confirmar asistencia.
5. Administrador → Check-in → **Abrir cámara** en el celular y leer el QR. Registrar el ingreso con o sin etiqueta.
6. Inscripciones → **Descargar Excel**.

## Etiquetas

La etiqueta se imprime con el diálogo de impresión del navegador, en el tamaño definido en `config.js` (`label`, en milímetros; por defecto 90 × 55). Hay que elegir la impresora de etiquetas y, la primera vez, sacar encabezados y márgenes.

## Seguridad

- Las inscripciones solo las leen los administradores (seguridad a nivel de filas en Supabase).
- El público solo puede: ver eventos publicados, enviar una inscripción y ver su propia entrada con el código que recibe por correo.
- Aprobar, rechazar, hacer check-in y configurar correos pasan por funciones que verifican que el usuario sea administrador.

## Pendiente

- Pase para Apple Wallet y Google Wallet (requiere cuentas de emisor).
- Dominio propio para el remitente de los correos.
- Prueba de impresión con la impresora de etiquetas real.
- Protección anti-robots en el formulario público (hoy hay un campo trampa y un límite por minuto).

## Estructura

```
index.html      estructura de la página
styles.css      diseño
app.js          lógica del sitio y del panel
config.js       conexión a Supabase y tamaño de etiqueta
vendor/         librerías (Supabase, QR, Excel, lector de QR)
supabase/       esquema de la base de datos
```
