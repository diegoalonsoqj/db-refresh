-- ===========================================================================
-- db-refresh — Esquema consolidado (PostgreSQL 17)
-- Idempotente: seguro de re-ejecutar. Ver CLAUDE.md para el diseño.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- --- Enums -----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE engine_type AS ENUM ('sqlserver','postgres','mysql');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('pending','running','succeeded','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE item_status AS ENUM ('pending','dropping','importing','post_scripts','succeeded','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE auth_source AS ENUM ('local','ad');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- Catálogo GCP ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS gcp_projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Credenciales SQL reutilizables (usuario + contraseña) para lo que el Admin API
-- no cubre: post-scripts y, más adelante, restores nativos. La contraseña va
-- cifrada at-rest (AES-256-GCM, master key en APP_ENCRYPTION_KEY) o como
-- referencia a Secret Manager; nunca en claro ni devuelta por la API.
CREATE TABLE IF NOT EXISTS sql_credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  engine       engine_type NOT NULL,
  username     text NOT NULL,
  secret_kind  text NOT NULL CHECK (secret_kind IN ('stored', 'ref')),
  password_enc bytea,           -- secret_kind = 'stored'
  secret_ref   text,            -- secret_kind = 'ref' (sm://... | env:NOMBRE)
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,            -- FK a app_users (ON DELETE SET NULL) al final del esquema
  CONSTRAINT chk_cred_secret CHECK (
    (secret_kind = 'stored' AND password_enc IS NOT NULL) OR
    (secret_kind = 'ref'    AND secret_ref   IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS gcp_instances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_ref    uuid NOT NULL REFERENCES gcp_projects(id) ON DELETE RESTRICT,
  instance_name  text NOT NULL,
  engine         engine_type NOT NULL,
  -- Conexión SQL (IP privada + credencial): solo para post-scripts; el restore
  -- va por el Admin API y no la usa.
  db_host        text,
  db_port        int,
  credential_ref uuid REFERENCES sql_credentials(id) ON DELETE RESTRICT,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_ref, instance_name)
);

-- Migraciones idempotentes de la conexión SQL de instancias:
-- 1) opcional (solo post-scripts); 2) usuario/secret_ref sueltos -> credencial.
ALTER TABLE gcp_instances ALTER COLUMN db_host DROP NOT NULL;
ALTER TABLE gcp_instances ADD COLUMN IF NOT EXISTS credential_ref uuid
  REFERENCES sql_credentials(id) ON DELETE RESTRICT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'gcp_instances'
                AND column_name = 'admin_user') THEN
    -- Cada instancia con usuario + secret_ref VÁLIDO (sm://... | env:NOMBRE) pasa a
    -- tener su propia credencial. Un secret_ref con otro contenido (p.ej. una
    -- contraseña escrita en claro antes de validar el formato) NO se migra: se
    -- descarta al eliminar la columna y hay que crear la credencial de nuevo.
    INSERT INTO sql_credentials (name, engine, username, secret_kind, secret_ref, description)
    SELECT 'migrada-' || i.instance_name || '-' || left(i.id::text, 8), i.engine,
           i.admin_user, 'ref', i.secret_ref, 'Migrada automáticamente desde la instancia ' || i.instance_name
      FROM gcp_instances i
     WHERE i.admin_user IS NOT NULL AND i.credential_ref IS NULL
       AND i.secret_ref ~ '^(sm://projects/[^/]+/secrets/[^/]+(/versions/[^/]+)?|env:[A-Za-z_][A-Za-z0-9_]*)$'
    ON CONFLICT (name) DO NOTHING;
    UPDATE gcp_instances i
       SET credential_ref = c.id
      FROM sql_credentials c
     WHERE c.name = 'migrada-' || i.instance_name || '-' || left(i.id::text, 8)
       AND i.credential_ref IS NULL;
    ALTER TABLE gcp_instances DROP COLUMN admin_user;
    ALTER TABLE gcp_instances DROP COLUMN secret_ref;
  END IF;
END $$;
-- Saneamiento idempotente: credenciales migradas cuyo secret_ref no es una
-- referencia válida (contenían un valor en claro) se desvinculan y se eliminan.
DO $$ BEGIN
  UPDATE gcp_instances SET credential_ref = NULL
   WHERE credential_ref IN (
     SELECT id FROM sql_credentials
      WHERE name LIKE 'migrada-%' AND secret_kind = 'ref'
        AND secret_ref !~ '^(sm://projects/[^/]+/secrets/[^/]+(/versions/[^/]+)?|env:[A-Za-z_][A-Za-z0-9_]*)$');
  DELETE FROM sql_credentials
   WHERE name LIKE 'migrada-%' AND secret_kind = 'ref'
     AND secret_ref !~ '^(sm://projects/[^/]+/secrets/[^/]+(/versions/[^/]+)?|env:[A-Za-z_][A-Za-z0-9_]*)$';
END $$;

CREATE TABLE IF NOT EXISTS gcp_buckets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_ref uuid NOT NULL REFERENCES gcp_projects(id) ON DELETE RESTRICT,
  bucket_name text NOT NULL,
  base_prefix text,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_ref, bucket_name, base_prefix)
);

CREATE TABLE IF NOT EXISTS instance_buckets (
  instance_ref uuid NOT NULL REFERENCES gcp_instances(id) ON DELETE CASCADE,
  bucket_ref   uuid NOT NULL REFERENCES gcp_buckets(id)   ON DELETE RESTRICT,
  is_default   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (instance_ref, bucket_ref)
);

-- Post-scripts SQL por instancia: se ejecutan (en sort_order) tras un job en el
-- que TODAS las restauraciones salieron OK. Equivale a EXTRA_SQL_SCRIPTS_PATH del
-- script original. sql_text admite separadores `GO` (lotes). database_name NULL
-- = BD por defecto del login (master en SQL Server).
CREATE TABLE IF NOT EXISTS instance_post_scripts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref  uuid NOT NULL REFERENCES gcp_instances(id) ON DELETE CASCADE,
  name          text NOT NULL,
  database_name text,
  sql_text      text NOT NULL,
  sort_order    int  NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_ref, name)
);
CREATE INDEX IF NOT EXISTS idx_post_scripts_instance ON instance_post_scripts (instance_ref, sort_order);

-- --- Usuarios / auth -------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE,  -- obligatorio en local; opcional en ad (se lee del directorio)
  username      text,         -- cuenta de AD (sAMAccountName, sin dominio); NULL en local
  full_name     text,
  role          text NOT NULL DEFAULT 'operator',   -- admin | operator | viewer
  auth_source   auth_source NOT NULL DEFAULT 'local',
  password_hash text,        -- solo local
  ad_dn         text,        -- solo ad (DN leído del directorio; NULL en bind directo)
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_auth_local CHECK (auth_source <> 'local' OR password_hash IS NOT NULL),
  CONSTRAINT chk_auth_ad    CHECK (auth_source <> 'ad'    OR username IS NOT NULL)
);

-- Migración idempotente: usuarios AD pre-provisionados por un admin (como en
-- db-keeper). Se identifican por `username` (sAMAccountName); email pasa a ser
-- opcional para ellos. Los AD auto-creados antes se rellenan desde su email.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL;
UPDATE app_users SET username = lower(split_part(email, '@', 1))
 WHERE auth_source = 'ad' AND username IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_username ON app_users (lower(username));
DO $$ BEGIN
  ALTER TABLE app_users DROP CONSTRAINT IF EXISTS chk_auth_ad;
  ALTER TABLE app_users ADD  CONSTRAINT chk_auth_ad    CHECK (auth_source <> 'ad'    OR username IS NOT NULL);
  ALTER TABLE app_users DROP CONSTRAINT IF EXISTS chk_local_email;
  ALTER TABLE app_users ADD  CONSTRAINT chk_local_email CHECK (auth_source <> 'local' OR email IS NOT NULL);
END $$;

-- --- Jobs de restauración --------------------------------------------------
CREATE TABLE IF NOT EXISTS restore_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref  uuid NOT NULL REFERENCES gcp_instances(id) ON DELETE RESTRICT,
  bucket_ref    uuid REFERENCES gcp_buckets(id),
  engine        engine_type NOT NULL,
  requested_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  bucket_path   text NOT NULL,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  locked_at     timestamptz,
  locked_by     text
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON restore_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_instance       ON restore_jobs (instance_ref);

CREATE TABLE IF NOT EXISTS restore_job_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_ref       uuid NOT NULL REFERENCES restore_jobs(id) ON DELETE CASCADE,
  backup_file   text NOT NULL,
  target_db     text NOT NULL,
  seq           int  NOT NULL,
  status        item_status NOT NULL DEFAULT 'pending',
  size_bytes    bigint,
  gcp_operation text,
  error_message text,
  started_at    timestamptz,
  finished_at   timestamptz,
  UNIQUE (job_ref, seq)
);
CREATE INDEX IF NOT EXISTS idx_items_job ON restore_job_items (job_ref);
-- Migración idempotente: owner del import (PostgreSQL, importContext.importUser).
-- NULL = usuario por defecto de Cloud SQL.
ALTER TABLE restore_job_items ADD COLUMN IF NOT EXISTS import_user text;

CREATE TABLE IF NOT EXISTS job_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_ref    uuid NOT NULL REFERENCES restore_jobs(id) ON DELETE CASCADE,
  item_ref   uuid REFERENCES restore_job_items(id) ON DELETE CASCADE,
  level      text NOT NULL DEFAULT 'info',
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_job ON job_events (job_ref, id);

-- --- Programación ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_restores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref uuid NOT NULL REFERENCES gcp_instances(id) ON DELETE CASCADE,
  bucket_ref   uuid NOT NULL REFERENCES gcp_buckets(id),
  cron_expr    text NOT NULL,
  mapping      jsonb NOT NULL,   -- [{backup_file, target_db, seq}, ...]
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  last_run_at  timestamptz,
  next_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_active_next ON scheduled_restores (is_active, next_run_at);

-- --- Configuración de la app (settings runtime) ---------------------------
-- Clave/valor. `value` guarda campos NO secretos (jsonb, legible en la API);
-- `secret_enc` guarda el secreto cifrado at-rest con AES-256-GCM (la master key
-- vive en APP_ENCRYPTION_KEY, fuera de la BD). Keys conocidas:
--   'auth.ad'             value={url,baseDn,bindDn}      secret_enc=bindPassword
--   'gcp.service_account' value={client_email,project_id,type} secret_enc=JSON SA completo
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc bytea,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);

-- --- Auditoría -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text,
  metadata   jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);

-- --- Migraciones idempotentes de FKs a app_users -> ON DELETE SET NULL -------
-- Permite eliminar un usuario conservando su historial/auditoría (actor -> NULL).
-- Recrea la FK con la regla correcta en BDs ya existentes (CREATE TABLE no la altera).
DO $$ BEGIN
  ALTER TABLE audit_log          DROP CONSTRAINT IF EXISTS audit_log_actor_fkey;
  ALTER TABLE audit_log          ADD  CONSTRAINT audit_log_actor_fkey
    FOREIGN KEY (actor)        REFERENCES app_users(id) ON DELETE SET NULL;
  ALTER TABLE restore_jobs       DROP CONSTRAINT IF EXISTS restore_jobs_requested_by_fkey;
  ALTER TABLE restore_jobs       ADD  CONSTRAINT restore_jobs_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES app_users(id) ON DELETE SET NULL;
  ALTER TABLE scheduled_restores DROP CONSTRAINT IF EXISTS scheduled_restores_created_by_fkey;
  ALTER TABLE scheduled_restores ADD  CONSTRAINT scheduled_restores_created_by_fkey
    FOREIGN KEY (created_by)   REFERENCES app_users(id) ON DELETE SET NULL;
  ALTER TABLE app_settings       DROP CONSTRAINT IF EXISTS app_settings_updated_by_fkey;
  ALTER TABLE app_settings       ADD  CONSTRAINT app_settings_updated_by_fkey
    FOREIGN KEY (updated_by)   REFERENCES app_users(id) ON DELETE SET NULL;
  ALTER TABLE sql_credentials    DROP CONSTRAINT IF EXISTS sql_credentials_updated_by_fkey;
  ALTER TABLE sql_credentials    ADD  CONSTRAINT sql_credentials_updated_by_fkey
    FOREIGN KEY (updated_by)   REFERENCES app_users(id) ON DELETE SET NULL;
END $$;
