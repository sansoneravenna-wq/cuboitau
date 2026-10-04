-- Cubo Itaú Eventos · base de datos para Supabase
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr sin perder datos.

create extension if not exists pg_net;
create schema if not exists priv;

-- ───────────── Tablas ─────────────
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org text not null default 'Cubo Itaú' check (org in ('Cubo Itaú','RedTickets')),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  place text not null default 'Cubo Itaú Uruguay',
  address text not null default 'Víctor Soliño 349, Montevideo',
  capacity int,
  description text not null default '',
  image_url text,
  fields jsonb not null default '[]'::jsonb,
  mails jsonb not null default '{}'::jsonb,
  notify_to text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  code text not null unique,
  email text not null,
  data jsonb not null,
  status text not null default 'pendiente' check (status in ('pendiente','aprobada','rechazada')),
  created_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  confirmed_at timestamptz,
  checkin_at timestamptz,
  label_printed boolean not null default false,
  unique (event_id, email)
);
create index if not exists registrations_event_idx on public.registrations(event_id);

create table if not exists public.app_config (key text primary key, value text not null);

create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  event_id uuid references public.events(id) on delete cascade,
  registration_id uuid references public.registrations(id) on delete set null,
  kind text not null,
  recipient text not null,
  subject text not null,
  request_id bigint,
  note text,
  created_at timestamptz not null default now()
);

-- ───────────── Permisos ─────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

alter table public.admins enable row level security;
alter table public.events enable row level security;
alter table public.registrations enable row level security;
alter table public.app_config enable row level security;
alter table public.email_log enable row level security;

revoke all on public.admins, public.events, public.registrations, public.app_config, public.email_log from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant select, delete on public.registrations to authenticated;
grant select on public.admins to authenticated;

drop policy if exists events_read on public.events;
create policy events_read on public.events for select using (published or public.is_admin());
drop policy if exists events_write on public.events;
create policy events_write on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists regs_admin_read on public.registrations;
create policy regs_admin_read on public.registrations for select to authenticated using (public.is_admin());
drop policy if exists regs_admin_delete on public.registrations;
create policy regs_admin_delete on public.registrations for delete to authenticated using (public.is_admin());
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (user_id = auth.uid());

-- Archivos: imágenes de eventos y códigos QR (lectura pública por dirección, carga solo administradores)
insert into storage.buckets (id, name, public) values ('eventos','eventos',true), ('qr','qr',true)
on conflict (id) do nothing;
drop policy if exists cubo_admin_files on storage.objects;
create policy cubo_admin_files on storage.objects for all to authenticated
  using (bucket_id in ('eventos','qr') and public.is_admin())
  with check (bucket_id in ('eventos','qr') and public.is_admin());

-- ───────────── Utilidades internas (esquema priv: no accesible desde el sitio) ─────────────
create or replace function priv.esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;')
$$;

create or replace function priv.cfg(k text) returns text language sql stable as $$
  select value from public.app_config where key = k
$$;

create or replace function priv.urlencode(t text) returns text language plpgsql immutable as $$
declare b bytea := convert_to(coalesce(t,''),'UTF8'); o text := ''; c int;
begin
  for i in 0..length(b)-1 loop
    c := get_byte(b,i);
    if (c between 48 and 57) or (c between 65 and 90) or (c between 97 and 122) or c in (45,46,95,126) then
      o := o || chr(c);
    else
      o := o || '%' || upper(lpad(to_hex(c),2,'0'));
    end if;
  end loop;
  return o;
end $$;

create or replace function priv.fecha(ts timestamptz) returns text language sql stable as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from l)::int + 1]
      || ', ' || extract(day from l)::int || ' de '
      || (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre'])[extract(month from l)::int]
  from (select ts at time zone 'America/Montevideo' as l) x
$$;

create or replace function priv.hora(a timestamptz, b timestamptz) returns text language sql stable as $$
  select to_char(a at time zone 'America/Montevideo','HH24:MI') || ' a ' || to_char(b at time zone 'America/Montevideo','HH24:MI') || ' h'
$$;

create or replace function priv.gen_code() returns text language plpgsql volatile as $$
declare abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; o text; idx int[] := array[0,1,2,3,4,5,9,10,11,12];
begin
  loop
    b := uuid_send(gen_random_uuid()); o := 'CI-';
    for i in 1..10 loop
      o := o || substr(abc, 1 + (get_byte(b, idx[i]) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.registrations where code = o);
  end loop;
  return o;
end $$;

create or replace function priv.tpl(ev public.events, kind text, part text) returns text language sql stable as $$
  select coalesce(nullif(ev.mails -> kind ->> part, ''),
    case kind || '.' || part
      when 'pendiente.subj' then 'Recibimos tu solicitud para {evento}'
      when 'pendiente.body' then 'Tu inscripción quedó pendiente de aprobación. El equipo de Cubo Itaú la va a revisar y te avisamos por este medio.'
      when 'aprobada.subj'  then '¡Inscripción aprobada! {evento}'
      when 'aprobada.body'  then 'Tu lugar está confirmado. Presentá el código QR de este correo en el ingreso.'
      when 'rechazada.subj' then 'Tu solicitud para {evento}'
      when 'rechazada.body' then 'Esta vez no pudimos confirmar tu lugar. Gracias por tu interés; te esperamos en los próximos eventos.'
    end)
$$;

create or replace function priv.fill(t text, ev public.events, d jsonb) returns text language sql stable as $$
  select replace(replace(replace(replace(replace(replace(replace(t,
    '{nombre}', coalesce(d->>'nombre','')), '{apellido}', coalesce(d->>'apellido','')), '{empresa}', coalesce(d->>'empresa','')),
    '{evento}', ev.title), '{fecha}', priv.fecha(ev.starts_at)), '{hora}', priv.hora(ev.starts_at, ev.ends_at)), '{lugar}', ev.place)
$$;

create or replace function priv.btn(url text, label text, solid boolean default true) returns text language sql immutable as $$
  select '<a href="' || priv.esc(url) || '" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;'
    || case when solid then 'background:#f3f3f1;color:#0a0a0b;' else 'border:1px solid #3a3a3f;color:#f3f3f1;' end || '">' || priv.esc(label) || '</a>'
$$;

create or replace function priv.wrap(inner_html text) returns text language sql immutable as $$
  select '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>'
    || '<body style="margin:0;padding:0;background:#0a0a0b;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;"><tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#131315;border:1px solid #2a2a2e;border-radius:12px;font-family:Helvetica,Arial,sans-serif;color:#f3f3f1;">'
    || '<tr><td style="padding:20px 24px;border-bottom:1px solid #2a2a2e;font-size:13px;letter-spacing:2px;font-weight:700;">CUBO ITAÚ <span style="color:#9b9ba1;font-weight:400;">· EVENTOS</span></td></tr>'
    || '<tr><td style="padding:24px;font-size:15px;line-height:1.55;">' || inner_html || '</td></tr>'
    || '<tr><td style="padding:16px 24px;border-top:1px solid #2a2a2e;font-size:12px;color:#9b9ba1;">Plataforma de inscripciones por RedTickets</td></tr>'
    || '</table></td></tr></table></body></html>'
$$;

create or replace function priv.ics(ev public.events, p_code text) returns text language sql stable as $$
  select replace(encode(convert_to(
    'BEGIN:VCALENDAR' || E'\r\n' || 'VERSION:2.0' || E'\r\n' || 'PRODID:-//Cubo Itau Eventos//ES' || E'\r\n' || 'METHOD:PUBLISH' || E'\r\n'
    || 'BEGIN:VEVENT' || E'\r\n' || 'UID:' || p_code || '@cubo-itau-eventos' || E'\r\n'
    || 'DTSTAMP:' || to_char(now() at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'DTSTART:' || to_char(ev.starts_at at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'DTEND:' || to_char(ev.ends_at at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'SUMMARY:' || replace(replace(ev.title,',','\,'),';','\;') || E'\r\n'
    || 'LOCATION:' || replace(replace(ev.place || ', ' || ev.address,',','\,'),';','\;') || E'\r\n'
    || 'DESCRIPTION:Presentá tu código QR en el ingreso. Código: ' || p_code || E'\r\n'
    || 'END:VEVENT' || E'\r\n' || 'END:VCALENDAR' || E'\r\n', 'UTF8'), 'base64'), E'\n', '')
$$;

create or replace function priv.send_mail(p_to text, p_subject text, p_html text, p_attachments jsonb,
                                          p_event uuid, p_reg uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_key text := priv.cfg('resend_api_key');
        v_from text := coalesce(nullif(priv.cfg('mail_from'),''), 'Cubo Itaú Eventos <onboarding@resend.dev>');
        v_body jsonb; v_req bigint; v_note text;
begin
  if coalesce(v_key,'') = '' then
    v_note := 'No enviado: falta cargar la clave de Resend';
  else
    begin
      v_body := jsonb_build_object('from', v_from, 'to', jsonb_build_array(p_to), 'subject', p_subject, 'html', p_html);
      if p_attachments is not null then v_body := v_body || jsonb_build_object('attachments', p_attachments); end if;
      select net.http_post(url := 'https://api.resend.com/emails', body := v_body,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key)) into v_req;
    exception when others then
      v_note := 'Error al enviar: ' || sqlerrm;
    end;
  end if;
  insert into public.email_log (event_id, registration_id, kind, recipient, subject, request_id, note)
  values (p_event, p_reg, p_kind, p_to, p_subject, v_req, v_note);
end $$;

create or replace function priv.mail_for(r public.registrations, kind text, p_qr_url text) returns void
language plpgsql security definer set search_path = public as $$
declare ev public.events; site text := rtrim(coalesce(priv.cfg('site_url'),''),'/'); h text; att jsonb; gcal text;
begin
  select * into ev from public.events where id = r.event_id;
  h := '<p style="margin:0 0 14px;">Hola ' || priv.esc(r.data->>'nombre') || ':</p>'
    || '<p style="margin:0 0 18px;">' || replace(priv.esc(priv.fill(priv.tpl(ev, kind, 'body'), ev, r.data)), E'\n', '<br>') || '</p>';
  if kind = 'pendiente' then
    h := h || '<p style="margin:0;color:#9b9ba1;font-size:13px;">' || priv.esc(ev.title) || ' · ' || priv.esc(priv.fecha(ev.starts_at)) || ' · ' || priv.hora(ev.starts_at, ev.ends_at) || '</p>';
  elsif kind = 'aprobada' then
    h := h || '<p style="margin:0 0 18px;"><b>' || priv.esc(ev.title) || '</b><br>' || priv.esc(priv.fecha(ev.starts_at)) || ' · ' || priv.hora(ev.starts_at, ev.ends_at)
           || '<br>' || priv.esc(ev.place || ', ' || ev.address) || '</p>'
           || '<table role="presentation" cellpadding="0" cellspacing="0" style="background:#1c1c1f;border-radius:10px;margin:0 0 18px;"><tr>';
    if p_qr_url like 'https://%' then
      h := h || '<td style="padding:14px;"><img src="' || priv.esc(p_qr_url) || '" width="140" height="140" alt="Código QR de tu entrada" style="display:block;border-radius:6px;background:#ffffff;"></td>';
    end if;
    h := h || '<td style="padding:14px;font-size:14px;line-height:1.5;"><span style="font-size:11px;letter-spacing:1px;color:#9b9ba1;">TU ENTRADA</span><br><b>'
           || priv.esc((r.data->>'nombre') || ' ' || (r.data->>'apellido')) || '</b><br>' || priv.esc(r.data->>'empresa')
           || '<br><span style="font-family:Consolas,Menlo,monospace;">' || r.code || '</span></td></tr></table>';
    gcal := 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' || priv.urlencode(ev.title || ' · Cubo Itaú')
         || '&dates=' || to_char(ev.starts_at at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"') || '/' || to_char(ev.ends_at at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"')
         || '&location=' || priv.urlencode(ev.place || ', ' || ev.address)
         || '&details=' || priv.urlencode('Presentá tu código QR en el ingreso. Código: ' || r.code);
    h := h || '<p style="margin:0;">';
    if site <> '' then h := h || priv.btn(site || '/#/entrada/' || r.code, 'Ver mi entrada y confirmar asistencia'); end if;
    h := h || priv.btn(gcal, 'Agregar a Google Calendar', false) || '</p>'
           || '<p style="margin:10px 0 0;color:#9b9ba1;font-size:13px;">Adjuntamos la invitación de calendario para que la agregues con un clic.</p>';
    att := jsonb_build_array(jsonb_build_object('filename', 'evento.ics', 'content', priv.ics(ev, r.code)));
  end if;
  perform priv.send_mail(r.email, priv.fill(priv.tpl(ev, kind, 'subj'), ev, r.data), priv.wrap(h), att, ev.id, r.id, kind);
end $$;

-- ───────────── Funciones que usa el sitio ─────────────

-- Cantidad de confirmados por evento publicado
create or replace function public.public_counts() returns table (event_id uuid, approved bigint)
language sql stable security definer set search_path = public as $$
  select e.id, count(r.id) filter (where r.status = 'aprobada')
  from public.events e left join public.registrations r on r.event_id = e.id
  where e.published group by e.id
$$;

-- Inscripción pública: queda pendiente y dispara los correos
create or replace function public.register(p_event uuid, p_data jsonb, p_hp text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare ev public.events; f jsonb; v text; clean jsonb := '{}'::jsonb; k text; v_email text; r public.registrations;
begin
  if coalesce(p_hp,'') <> '' then return jsonb_build_object('ok', true); end if;
  select * into ev from public.events where id = p_event and published;
  if not found then raise exception 'Este evento no está disponible.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 8000 then
    raise exception 'No pudimos leer el formulario. Recargá la página y probá de nuevo.';
  end if;
  if (select count(*) from public.registrations where event_id = ev.id and created_at > now() - interval '1 minute') > 60 then
    raise exception 'Hay muchas solicitudes en este momento. Probá de nuevo en unos minutos.';
  end if;

  foreach k in array array['nombre','apellido','email','empresa'] loop
    v := btrim(coalesce(p_data->>k,''));
    if v = '' then raise exception 'Falta completar: %.', initcap(k); end if;
    if length(v) > 120 then raise exception 'El campo % es demasiado largo.', initcap(k); end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  v_email := lower(clean->>'email');
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Revisá el email: tiene que tener el formato nombre@dominio.com.';
  end if;
  clean := clean || jsonb_build_object('email', v_email);

  for f in select * from jsonb_array_elements(ev.fields) loop
    k := f->>'id';
    if f->>'type' = 'checkbox' then
      if coalesce((f->>'required')::boolean, false) and coalesce(p_data->>k,'') <> 'true' then
        raise exception 'Falta marcar: %.', f->>'label';
      end if;
      clean := clean || jsonb_build_object(k, coalesce(p_data->>k,'') = 'true');
    else
      v := btrim(coalesce(p_data->>k,''));
      if coalesce((f->>'required')::boolean, false) and v = '' then raise exception 'Falta completar: %.', f->>'label'; end if;
      if length(v) > 2000 then raise exception 'El campo % es demasiado largo.', f->>'label'; end if;
      if f->>'type' = 'select' and v <> '' and not (f->'options' ? v) then raise exception 'Elegí una opción válida en: %.', f->>'label'; end if;
      clean := clean || jsonb_build_object(k, v);
    end if;
  end loop;

  -- Si ese email ya está inscripto se responde igual, sin crear otra solicitud ni reenviar correos
  if exists (select 1 from public.registrations where event_id = ev.id and email = v_email) then
    return jsonb_build_object('ok', true);
  end if;

  insert into public.registrations (event_id, code, email, data)
  values (ev.id, priv.gen_code(), v_email, clean) returning * into r;

  perform priv.mail_for(r, 'pendiente', null);
  if coalesce(ev.notify_to,'') <> '' then
    perform priv.send_mail(ev.notify_to, 'Nueva inscripción en ' || ev.title || ': ' || (clean->>'nombre') || ' ' || (clean->>'apellido'),
      priv.wrap('<p style="margin:0 0 14px;"><b>' || priv.esc((clean->>'nombre') || ' ' || (clean->>'apellido')) || '</b> (' || priv.esc(clean->>'empresa') || ') pidió inscribirse a <b>'
        || priv.esc(ev.title) || '</b>.</p><p style="margin:0 0 14px;">Email: ' || priv.esc(v_email) || '</p>'
        || case when coalesce(priv.cfg('site_url'),'') <> '' then '<p style="margin:0;">' || priv.btn(rtrim(priv.cfg('site_url'),'/') || '/#/admin', 'Revisar en el panel') || '</p>' else '' end),
      null, ev.id, r.id, 'aviso');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Aprobar, rechazar o reenviar el correo (solo administradores)
create or replace function public.review(p_reg uuid, p_action text, p_qr_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.registrations; v_org text;
begin
  select org into v_org from public.admins where user_id = auth.uid();
  if v_org is null then raise exception 'No tenés permiso de administrador.'; end if;
  select * into r from public.registrations where id = p_reg for update;
  if not found then raise exception 'No encontramos esa inscripción.'; end if;

  if p_action = 'aprobar' then
    update public.registrations set status = 'aprobada', reviewed_by = v_org, reviewed_at = now() where id = p_reg returning * into r;
  elsif p_action = 'rechazar' then
    if r.checkin_at is not null then raise exception 'Esta persona ya ingresó al evento; no se puede rechazar.'; end if;
    update public.registrations set status = 'rechazada', reviewed_by = v_org, reviewed_at = now() where id = p_reg returning * into r;
  elsif p_action <> 'reenviar' then
    raise exception 'Acción no válida.';
  end if;
  perform priv.mail_for(r, r.status, p_qr_url);
  return jsonb_build_object('ok', true, 'status', r.status);
end $$;

-- Entrada del asistente (solo si está aprobada)
create or replace function public.ticket(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', r.code, 'nombre', r.data->>'nombre', 'apellido', r.data->>'apellido', 'empresa', r.data->>'empresa',
    'confirmed', r.confirmed_at is not null, 'checkin', r.checkin_at is not null,
    'event', jsonb_build_object('title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'place', e.place, 'address', e.address, 'image_url', e.image_url))
  from public.registrations r join public.events e on e.id = r.event_id
  where r.code = upper(btrim(p_code)) and r.status = 'aprobada'
$$;

create or replace function public.confirm_attendance(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.registrations set confirmed_at = coalesce(confirmed_at, now())
  where code = upper(btrim(p_code)) and status = 'aprobada';
  return found;
end $$;

-- Check-in: validar el código y registrar el ingreso (solo administradores)
create or replace function public.checkin_validate(p_event uuid, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.registrations; v_code text := upper(btrim(coalesce(p_code,''))); v_title text;
begin
  if not public.is_admin() then raise exception 'No tenés permiso de administrador.'; end if;
  if v_code = '' then return jsonb_build_object('kind','bad','msg','Escribí o leé un código.'); end if;
  select * into r from public.registrations where code = v_code;
  if not found then return jsonb_build_object('kind','bad','msg','Código no encontrado: ' || v_code || '. No corresponde a ninguna inscripción.'); end if;
  if r.event_id <> p_event then
    select title into v_title from public.events where id = r.event_id;
    return jsonb_build_object('kind','bad','msg','Este QR es de otro evento: ' || v_title || '.');
  end if;
  if r.status <> 'aprobada' then
    return jsonb_build_object('kind','bad','msg','La inscripción de ' || (r.data->>'nombre') || ' ' || (r.data->>'apellido') || ' no está aprobada.');
  end if;
  return jsonb_build_object('kind', case when r.checkin_at is null then 'ok' else 'dup' end, 'reg', to_jsonb(r));
end $$;

create or replace function public.checkin_mark(p_reg uuid, p_print boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.registrations;
begin
  if not public.is_admin() then raise exception 'No tenés permiso de administrador.'; end if;
  update public.registrations set checkin_at = coalesce(checkin_at, now()), label_printed = label_printed or coalesce(p_print, false)
  where id = p_reg and status = 'aprobada' returning * into r;
  if not found then raise exception 'La inscripción no está aprobada.'; end if;
  return to_jsonb(r);
end $$;

-- Configuración de envío de correos (solo administradores; la clave nunca se devuelve)
create or replace function public.set_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'No tenés permiso de administrador.'; end if;
  if p_key not in ('resend_api_key','mail_from','site_url') then raise exception 'Configuración no válida.'; end if;
  insert into public.app_config (key, value) values (p_key, btrim(coalesce(p_value,'')))
  on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.config_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'No tenés permiso de administrador.'; end if;
  return jsonb_build_object('has_key', coalesce(priv.cfg('resend_api_key'),'') <> '',
    'mail_from', coalesce(priv.cfg('mail_from'),''), 'site_url', coalesce(priv.cfg('site_url'),''));
end $$;

create or replace function public.send_test_mail(p_to text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'No tenés permiso de administrador.'; end if;
  if btrim(coalesce(p_to,'')) !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Escribí un email válido para la prueba.'; end if;
  perform priv.send_mail(btrim(p_to), 'Prueba de correo · Cubo Itaú Eventos',
    priv.wrap('<p style="margin:0;">Si estás leyendo esto, el envío de correos quedó funcionando.</p>'), null, null, null, 'prueba');
end $$;

-- Registro de correos con el resultado del envío
create or replace function public.email_log_list(p_event uuid) returns table
  (created_at timestamptz, kind text, recipient text, subject text, note text, status_code int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'No tenés permiso de administrador.'; end if;
  return query
    select l.created_at, l.kind, l.recipient, l.subject,
           coalesce(l.note, case when h.status_code >= 300 then left(h.content::text, 200) end), h.status_code::int
    from public.email_log l left join net._http_response h on h.id = l.request_id
    where l.event_id is not distinct from p_event or l.kind = 'prueba'
    order by l.created_at desc limit 100;
end $$;

revoke all on schema priv from public, anon, authenticated;
revoke execute on all functions in schema public from public;
grant execute on function public.is_admin(), public.public_counts(), public.register(uuid, jsonb, text),
  public.ticket(text), public.confirm_attendance(text) to anon, authenticated;
grant execute on function public.review(uuid, text, text), public.checkin_validate(uuid, text), public.checkin_mark(uuid, boolean),
  public.set_config(text, text), public.config_status(), public.send_test_mail(text), public.email_log_list(uuid) to authenticated;
