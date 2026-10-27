-- Datos de prueba · pegar en Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- No envía correos. Todas las personas de prueba tienen email @ejemplo.com (salvo una, para recibir el certificado).
-- 4. Más QR para probar el tótem: 16 aprobados nuevos en Beyond the Hype (CI-DEMOB00001 a 16)
insert into public.registrations (event_id, code, email, data, status, reviewed_by, reviewed_at)
select e.id, 'CI-DEMOB' || lpad(g::text, 5, '0'), 'demo.b' || g || '@ejemplo.com',
  jsonb_build_object('nombre', (array['Lucía','Martín','Sofía','Diego','Camila','Juan Pablo','Valeria','Federico','Agustina','Rodrigo','María José','Emiliano','Paula','Tomás','Carla','Ignacio'])[g], 'apellido', (array['Bentancor','Olivera','Larrañaga','Fernández','Etcheverry','Rodríguez','Méndez','Castro','Pintos','Silveira','Fernández Abella','Cardozo','Rivero','Alonso','Domínguez','Bentos'])[g], 'empresa', (array['Nodo Agro','Puerto Datos','Pampa Pagos','Grupo Andén','Estudio Prisma','Caja Sur','Tero Logística','Agencia Faro','Banda Oriental Media','Molino Ventures','Puerto Datos','Nodo Agro','Pampa Pagos','Grupo Andén','Estudio Prisma','Caja Sur'])[g],
    'email', 'demo.b' || g || '@ejemplo.com', 'consent', true),
  'aprobada', 'RedTickets', now()
from public.events e, generate_series(1, 16) g
where e.slug = 'beyond-the-hype'
on conflict do nothing;

-- Para borrarlos, ver el final del archivo.

-- 1. Beyond the Hype: campo de celular para probar WhatsApp + 20 inscripciones (12 aprobadas, 4 pendientes, 4 rechazadas)
update public.events
set fields = fields || '[{"id":"telefono","label":"Celular (WhatsApp)","type":"tel","required":false}]'::jsonb
where slug = 'beyond-the-hype' and not fields @> '[{"type":"tel"}]'::jsonb;

insert into public.registrations (event_id, code, email, data, status, reviewed_by, reviewed_at, created_at)
select e.id, 'CI-DEMOA' || lpad(g::text, 5, '0'), 'demo.a' || g || '@ejemplo.com',
  jsonb_build_object(
    'nombre',   (array['Valentina','Joaquín','Sofía','Mateo','Camila','Santiago','Martina','Facundo','Agustina','Nicolás','Florencia','Bruno','Lucía','Federico','Micaela','Gonzalo','Carolina','Diego','Paula','Andrés'])[g],
    'apellido', (array['Rocha','Bentancor','Cabrera','Acosta','Silva','Pereira','Rodríguez','Méndez','Castro','Sosa','Viera','Suárez','Fernández','Olivera','Núñez','Gómez','Pereyra','Martínez','López','Díaz'])[g],
    'empresa',  (array['Tero Logística','Agencia Faro','Banda Oriental Media','Pampa Pagos','Grupo Andén','Molino Ventures','Estudio Prisma','Caja Sur','Nodo Agro','Puerto Datos'])[1 + g % 10],
    'email', 'demo.a' || g || '@ejemplo.com',
    'cargo', (array['CEO','Product manager','Marketing','Ventas','Desarrollo'])[1 + g % 5],
    'relacion', (array['Startup residente','Corporación socia','Inversor','Invitado'])[1 + g % 4],
    'telefono', '09' || (1000000 + g * 37311)::text,
    'consent', true),
  case when g % 5 in (0,1,2) then 'aprobada' when g % 5 = 3 then 'pendiente' else 'rechazada' end,
  case when g % 5 <> 3 then 'RedTickets' end,
  case when g % 5 <> 3 then now() end,
  now() - (g || ' hours')::interval
from public.events e, generate_series(1, 20) g
where e.slug = 'beyond-the-hype'
on conflict do nothing;

-- 2. Evento ya realizado, para probar certificados: 10 aprobados, 7 con ingreso registrado (5 con etiqueta)
insert into public.events (slug, title, starts_at, ends_at, description, published)
values ('workshop-de-prueba', 'Workshop de prueba · Innovación abierta',
  date_trunc('day', now()) - interval '8 days' + interval '21 hours 30 minutes',
  date_trunc('day', now()) - interval '8 days' + interval '23 hours 30 minutes',
  'Evento de prueba ya realizado, para ensayar el envío de certificados.', true)
on conflict (slug) do nothing;

insert into public.registrations (event_id, code, email, data, status, reviewed_by, reviewed_at, checkin_at, label_printed, created_at)
select e.id, 'CI-DEMOW' || lpad(g::text, 5, '0'), 'demo.w' || g || '@ejemplo.com',
  jsonb_build_object(
    'nombre',   (array['Ana','Pablo','Laura','Ignacio','Victoria','Tomás','Inés','Rodrigo','Julieta','Marcos'])[g],
    'apellido', (array['Paz','Ramos','Ibarra','Ferreira','Lima','Correa','Vidal','Silveira','Arias','Duarte'])[g],
    'empresa',  (array['Estudio Prisma','Pampa Pagos','Nodo Agro','Grupo Andén','Puerto Datos'])[1 + g % 5],
    'email', 'demo.w' || g || '@ejemplo.com', 'consent', true),
  'aprobada', 'Cubo Itaú', e.starts_at - interval '2 days',
  case when g <= 7 then e.starts_at + (g * 4 || ' minutes')::interval end,
  g <= 5,
  e.starts_at - interval '5 days'
from public.events e, generate_series(1, 10) g
where e.slug = 'workshop-de-prueba'
on conflict do nothing;

-- Una asistente con el Gmail de la cuenta de Resend, para recibir el certificado de verdad
insert into public.registrations (event_id, code, email, data, status, reviewed_by, reviewed_at, checkin_at, label_printed)
select e.id, 'CI-DEMOW00099', 'sansoneravenna@gmail.com',
  '{"nombre":"Lorenzo","apellido":"Prueba","empresa":"RedTickets","email":"sansoneravenna@gmail.com","consent":true}'::jsonb,
  'aprobada', 'RedTickets', e.starts_at - interval '2 days', e.starts_at + interval '3 minutes', true
from public.events e where e.slug = 'workshop-de-prueba'
on conflict do nothing;

-- 3. Borrador del evento piloto de noviembre, de tres días
insert into public.events (slug, title, starts_at, ends_at, description, published, fields)
values ('evento-piloto-noviembre', 'Evento piloto · 24 al 26 de noviembre',
  '2026-11-24 09:00-03', '2026-11-26 19:00-03',
  '[Descripción del evento piloto]', false,
  '[{"id":"cargo","label":"Cargo","type":"text","required":true},{"id":"telefono","label":"Celular (WhatsApp)","type":"tel","required":false}]')
on conflict (slug) do nothing;

-- Para borrar todos los datos de prueba, sacá los dos guiones del comienzo de estas líneas y corrélas:
-- delete from public.registrations where email like '%@ejemplo.com' or code = 'CI-DEMOW00099';
-- delete from public.events where slug in ('workshop-de-prueba', 'evento-piloto-noviembre');
