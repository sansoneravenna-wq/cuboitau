# Tótem de acreditación

El tótem cumple dos funciones en la misma pantalla:

- **Acreditación:** la persona acerca el QR al lector, la etiqueta sale sola y la pantalla ofrece **Listo** o **Reimprimir**. Si no tiene el QR, toca **No tengo mi QR** y se busca por apellido, nombre o empresa con el teclado de la pantalla.
- **Agenda:** debajo se ven los próximos eventos publicados. Tocando uno se ve el detalle y se puede pedir la inscripción con el teclado en pantalla; queda pendiente de aprobación como en el sitio.

Por defecto el tótem está en **modo automático**: acepta el QR de cualquier evento de Cubo que se esté realizando (desde 3 horas antes del inicio hasta 2 horas después del cierre). Si alguien acerca un QR de otra fecha, le avisa cuándo es su evento. La sección de acreditación aparece sola cuando hay un evento en curso; el resto del tiempo se ve solo la agenda. Desde la configuración (5 toques en el logo) también se puede fijar un único evento.

Dirección del tótem: `https://cuboeventos.uy/#/totem`

## 1. Base de datos (una vez)

1. En Supabase → **SQL Editor**, pegá otra vez todo [`supabase/schema.sql`](supabase/schema.sql) y tocá **Run**. No borra nada: agrega lo del tótem.
2. En **Authentication → Users → Add user**, creá un usuario solo para el tótem (por ejemplo `totem@redtickets.uy`), con contraseña y *Auto Confirm User*.
3. En **SQL Editor**, habilitalo como tótem:

   ```sql
   insert into public.kiosks (user_id, label)
   select id, 'Tótem Cubo' from auth.users where email = 'totem@redtickets.uy';
   ```

El usuario del tótem solo puede leer QR, buscar a los aprobados del evento elegido e imprimir. No entra al panel ni ve emails ni teléfonos. Por eso conviene que el tótem **no** use el usuario de un administrador.

## 2. Primera vez en el tótem

1. Abrí la dirección del tótem e ingresá con el usuario del tótem. Queda guardado en ese equipo.
2. Queda en modo automático. Si preferís fijar un evento, tocá el logo 5 veces y elegilo.
3. Tocá **Imprimir etiqueta de prueba** para revisar tamaño y márgenes.

Para cambiar de evento o cerrar la sesión: **tocá el logo 5 veces seguidas**.

## 3. Windows y Chrome

### Impresora

1. Instalá el controlador de la impresora de etiquetas y configurala como **impresora predeterminada** de Windows.
2. En sus preferencias, elegí el tamaño de etiqueta que van a usar.
3. El tamaño que pide el sitio se ajusta en `config.js` (`label`, en milímetros). Tiene que coincidir con el rollo.

### Impresora Brother QL-800 (lo que funcionó)

- **Etiquetas:** precortadas blancas de **29 × 90 mm** (tamaño `DC03` en el controlador). El diseño del sitio está hecho para esa medida (`config.js` → `label: { w: 90, h: 29, rollo: 29 }`).
- **Modo de color: Monocromo.** En modo "negro y rojo" las etiquetas blancas salen con el fondo oscuro. Ese modo es solo para el rollo rojo y negro (DK-22251).
- **Tamaño predeterminado: 29 × 90 mm.** Chrome, al imprimir directo, usa ese.
- Si se cambia el tipo de etiqueta, hay que cambiar estas tres cosas juntas: el tamaño en `config.js`, el tamaño predeterminado y el modo de color de la impresora.

En Mac, desde la Terminal:

```
sudo lpadmin -p Brother_QL_800 -o PageSize=DC03 -o BrMultiColor=BrMultiColorMonochrome
open -na "Google Chrome" --args --kiosk-printing --user-data-dir="$HOME/cubo-totem" "https://cuboeventos.uy/#/totem"
```

Si un trabajo queda trancado, los siguientes esperan atrás: vaciá la cola (`cancel -a Brother_QL_800`) y apagá y prendé la impresora.

### Lector de QR

- Se conecta por USB y funciona como un teclado: escribe el código y presiona Enter. No hace falta instalar nada.
- Si el lector permite configurarlo, dejalo con el sufijo **Enter** (suele venir así).
- No importa si Windows está en español: el sitio corrige el guion del código, que con teclado en español a veces llega como otro símbolo.

### Chrome en modo tótem

Creá un acceso directo a Chrome con este destino, todo en una línea:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing --noerrdialogs --disable-session-crashed-bubble "https://cuboeventos.uy/#/totem"
```

- `--kiosk` abre en pantalla completa, sin barras ni pestañas.
- `--kiosk-printing` imprime directo en la impresora predeterminada, sin mostrar el cuadro de impresión.
- Para salir del modo tótem: **Alt + F4** con un teclado conectado.

La primera vez, abrí Chrome normal, entrá a la dirección del tótem e iniciá sesión. Después cerralo y usá el acceso directo.

### Que arranque solo

1. **Inicio automático de Chrome:** copiá el acceso directo en la carpeta de inicio (Windows + R → `shell:startup`).
2. **Inicio de sesión automático de Windows:** Windows + R → `netplwiz` → desmarcá "Los usuarios deben escribir su nombre y contraseña".
3. **Que no se apague:** Configuración → Sistema → Inicio/apagado y suspensión → pantalla y suspensión en **Nunca**.
4. **Actualizaciones:** Windows Update → Horas activas, para que no reinicie en horario de eventos.
5. **Encendido al volver la corriente:** en la BIOS de la mini PC, la opción *Restore on AC power loss* o *Power on after power failure* en **On**. El nombre cambia según el modelo.

## 4. Antes de cada evento

- Rollo de etiquetas cargado y uno de repuesto.
- Prueba con un QR real de un aprobado: debe imprimir y mostrar el nombre.
- Prueba de **No tengo mi QR** con un apellido.
- Un celular o tablet en la mesa de acreditación con el panel abierto en **Check-in**, para los casos que el tótem no resuelve.

## Pantallas del tótem

| Pantalla | Cuándo aparece | Vuelve sola a la lectura |
| --- | --- | --- |
| Acercá el código QR | En espera | — |
| ¡Hola, Nombre! (Listo / Reimprimir) | QR válido; la etiqueta ya salió | a los 12 s |
| Ya estás acreditado/a | El QR ya se usó (por ejemplo, el segundo día) | a los 15 s |
| No pudimos validar tu entrada | Código desconocido, de otro evento o sin aprobar | a los 8 s |
| Buscá tu inscripción | Tocaron "No tengo mi QR" | a los 45 s sin uso |
