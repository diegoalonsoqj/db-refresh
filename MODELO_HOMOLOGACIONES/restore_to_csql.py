#!/usr/bin/env python3
"""
restore_to_csql.py - Versión FINAL con:
 - Multi .bak (BACKUP_FILES separados por comas)
 - Multi BD (DB_NAMES separados por comas, OBLIGATORIO)
 - Mapeo .bak -> BD por posición (estricto)
 - Eliminación de BD via sqlcmd
 - Validaciones antes de borrar
 - Validación gcloud + service account del KEY
 - Import .bak con gcloud + polling
 - Scripts extras .sql (GO compatible)
 - Logs UTF-8
"""

import os
import subprocess
import pyodbc
import logging
import json
import time
import shutil
from datetime import datetime
from dotenv import load_dotenv
from google.cloud import storage

# ----------------------------------------------------
# Cargar .env
# ----------------------------------------------------
load_dotenv()

BUCKET_PATH       = os.getenv("BUCKET_PATH")
GCP_PROJECT       = os.getenv("GCP_PROJECT")
GCP_INSTANCE      = os.getenv("GCP_INSTANCE")
GCP_KEY_PATH      = os.getenv("GCP_KEY_PATH")
SERVICE_ACCOUNT   = os.getenv("GCP_SERVICE_ACCOUNT_EMAIL")

DB_HOST           = os.getenv("DB_HOST")
DB_USER           = os.getenv("DB_USER")
DB_PASS           = os.getenv("DB_PASS")

BACKUP_FILES      = [b.strip() for b in os.getenv("BACKUP_FILES", "").split(",") if b.strip()]
DB_NAMES          = [d.strip() for d in os.getenv("DB_NAMES", "").split(",") if d.strip()]
EXTRA_SQL_SCRIPTS_PATH = os.getenv("EXTRA_SQL_SCRIPTS_PATH")
LOG_PATH          = os.getenv("LOG_PATH") or "restores.log"

OPERATION_TIMEOUT_SECONDS = int(os.getenv("OPERATION_TIMEOUT_SECONDS", "900"))
POLL_INTERVAL_SECONDS     = int(os.getenv("POLL_INTERVAL_SECONDS", "10"))

SQLCMD = shutil.which("sqlcmd") or "/opt/mssql-tools18/bin/sqlcmd"

# ----------------------------------------------------
# Logging
# ----------------------------------------------------
logging.basicConfig(
    filename=LOG_PATH,
    filemode="a",
    encoding="utf-8",
    level=logging.INFO,
    format="%(message)s"
)

def log_event(msg, level="INFO"):
    timestamp = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
    line = f"{timestamp} - {msg}"
    getattr(logging, level.lower())(line)
    print(line)

# ----------------------------------------------------
# Validar cuenta gcloud
# ----------------------------------------------------
def validate_gcloud_account():
    if not SERVICE_ACCOUNT or not GCP_KEY_PATH:
        log_event("❌ Debes configurar GCP_SERVICE_ACCOUNT_EMAIL y GCP_KEY_PATH en .env.", "ERROR")
        return False

    log_event("🔍 Validando cuenta activa de gcloud...")

    try:
        proc = subprocess.run(
            ["gcloud", "auth", "list", "--format=json"],
            capture_output=True, text=True
        )
        if proc.returncode != 0:
            log_event(f"❌ Error obteniendo cuentas de gcloud: {proc.stderr}", "ERROR")
            return False

        accounts = json.loads(proc.stdout)
        active = next((acc["account"] for acc in accounts if acc.get("status") == "ACTIVE"), None)

        if not active:
            log_event("❌ No hay cuenta activa en gcloud.", "ERROR")
            return False

        log_event(f"ℹ️ Cuenta activa de gcloud: {active}")

        if active != SERVICE_ACCOUNT:
            log_event(
                "⚠️ gcloud NO está usando la service account esperada.\n"
                f"   Actual:   {active}\n"
                f"   Esperada: {SERVICE_ACCOUNT}\n"
                "➡️ Activando service account desde el KEY JSON..."
            )

            proc2 = subprocess.run(
                [
                    "gcloud", "auth", "activate-service-account",
                    SERVICE_ACCOUNT,
                    f"--key-file={GCP_KEY_PATH}"
                ],
                capture_output=True, text=True
            )

            if proc2.returncode != 0:
                log_event(f"❌ No se pudo activar la service account: {proc2.stderr}", "ERROR")
                return False

            log_event(f"✅ Service account {SERVICE_ACCOUNT} activada correctamente.")
        else:
            log_event("✅ gcloud ya usa la service account correcta.")

        return True

    except Exception as e:
        log_event(f"❌ Error validando gcloud account: {e}", "ERROR")
        return False

# ----------------------------------------------------
# Validar conexión SQL Server con sqlcmd
# ----------------------------------------------------
def test_db_connection_sqlcmd():
    if not os.path.exists(SQLCMD):
        log_event(f"❌ sqlcmd no encontrado en: {SQLCMD}", "ERROR")
        return False

    try:
        proc = subprocess.run(
            [
                SQLCMD,
                "-S", DB_HOST,
                "-U", DB_USER,
                "-P", DB_PASS,
                "-C",
                "-Q", "SELECT @@VERSION"
            ],
            capture_output=True, text=True
        )

        if proc.returncode != 0:
            log_event(f"❌ Error al conectar con SQL Server (sqlcmd): {proc.stderr}", "ERROR")
            return False

        log_event("✅ Conexión exitosa a SQL Server mediante sqlcmd.")
        return True

    except Exception as e:
        log_event(f"❌ Error ejecutando sqlcmd: {e}", "ERROR")
        return False

# ----------------------------------------------------
# Listar bases de usuario
# ----------------------------------------------------
def list_databases_sqlcmd():
    system_dbs = {"master", "model", "msdb", "tempdb"}

    try:
        proc = subprocess.run(
            [
                SQLCMD, "-S", DB_HOST, "-U", DB_USER, "-P", DB_PASS,
                "-C", "-W", "-Q",
                "SET NOCOUNT ON; SELECT name FROM sys.databases;"
            ],
            capture_output=True, text=True
        )
        if proc.returncode != 0:
            log_event(f"❌ No se pudo listar bases: {proc.stderr}", "ERROR")
            return []

        lines = proc.stdout.splitlines()
        dbs = [
            l.strip() for l in lines
            if l.strip() and l.strip() not in ("name", "----")
        ]

        user_dbs = [db for db in dbs if db not in system_dbs]
        log_event(f"📚 Bases existentes (usuario): {user_dbs}")
        return user_dbs

    except Exception as e:
        log_event(f"❌ Error listando bases: {e}", "ERROR")
        return []

# ----------------------------------------------------
# DROP DATABASE vía sqlcmd
# ----------------------------------------------------
def drop_database_sqlcmd(db_name):
    log_event(f"🧹 Eliminando la base de datos: {db_name} ...")

    # SINGLE_USER
    kill_cmd = f"ALTER DATABASE [{db_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;"
    proc1 = subprocess.run(
        [SQLCMD, "-S", DB_HOST, "-U", DB_USER, "-P", DB_PASS, "-C", "-b", "-Q", kill_cmd],
        capture_output=True, text=True
    )
    if proc1.returncode != 0:
        log_event(f"⚠️ SINGLE_USER falló para {db_name}: {proc1.stderr}", "WARNING")

    # DROP DATABASE
    drop_cmd = f"DROP DATABASE [{db_name}];"
    proc2 = subprocess.run(
        [SQLCMD, "-S", DB_HOST, "-U", DB_USER, "-P", DB_PASS, "-C", "-b", "-Q", drop_cmd],
        capture_output=True, text=True
    )
    if proc2.returncode != 0:
        log_event(f"❌ DROP DATABASE falló para {db_name}: {proc2.stderr}", "ERROR")
        return False

    log_event(f"✅ Base de datos {db_name} eliminada correctamente.")
    return True

def drop_databases_if_exist(target_dbs, existing_dbs):
    existing_map = {db.lower(): db for db in existing_dbs}

    for target in target_dbs:
        real = existing_map.get(target.lower())
        if real:
            if not drop_database_sqlcmd(real):
                return False
        else:
            log_event(f"ℹ️ BD objetivo {target} no existe. No se elimina.")

    return True

# ----------------------------------------------------
# Validar backups en GCS
# ----------------------------------------------------
def validate_backups_in_bucket():
    found = []
    metas = {}

    try:
        client = storage.Client.from_service_account_json(GCP_KEY_PATH)

        bucket = BUCKET_PATH.replace("gs://", "").split("/")[0]
        prefix = BUCKET_PATH.replace(f"gs://{bucket}/", "")

        blobs = list(client.list_blobs(bucket, prefix=prefix))
        blob_names = [b.name.split("/")[-1] for b in blobs]

        for bak in BACKUP_FILES:
            if bak in blob_names:
                found.append(bak)
                blob = next(b for b in blobs if b.name.endswith(bak))
                metas[bak] = {
                    "size_mb": blob.size / 1024 / 1024,
                    "updated": blob.updated.isoformat(),
                    "blob_name": blob.name
                }
                log_event(f"📦 Backup encontrado: {bak} | {metas[bak]['size_mb']:.2f} MB")
            else:
                log_event(f"❌ Backup no encontrado: {bak}", "ERROR")

    except Exception as e:
        log_event(f"❌ Error accediendo al bucket: {e}", "ERROR")

    return found, metas

# ----------------------------------------------------
# Mapeo .bak → BD (DB_NAMES obligatorio)
# ----------------------------------------------------
def build_backup_db_map(found_baks):

    if not DB_NAMES:
        log_event("❌ DB_NAMES está vacío. Debes especificar las bases a restaurar.", "ERROR")
        return None

    if len(DB_NAMES) != len(BACKUP_FILES):
        log_event(
            f"❌ Error: BACKUP_FILES tiene {len(BACKUP_FILES)} elementos "
            f"y DB_NAMES tiene {len(DB_NAMES)}. Deben coincidir.",
            "ERROR"
        )
        return None

    bak_order = [b for b in BACKUP_FILES if b in found_baks]

    if not bak_order:
        log_event("❌ No hay backups válidos encontrados en GCS.", "ERROR")
        return None

    mapping = dict(zip(bak_order, DB_NAMES))
    log_event(f"🔗 Mapeo .bak → BD (estricto): {mapping}")

    return mapping

# ----------------------------------------------------
# Import Cloud SQL
# ----------------------------------------------------
def run_gcloud_import_and_wait(bak, db_name, blob_path):
    """
    Lanza el IMPORT en modo asíncrono y espera explícitamente
    a que la operación termine usando el operation ID.
    """
    log_event(f"🚀 Importando {bak} → {db_name}")

    # 1) Lanzamos el import en modo asíncrono
    cmd = [
        "gcloud", "sql", "import", "bak", GCP_INSTANCE,
        blob_path,
        f"--database={db_name}",
        f"--project={GCP_PROJECT}",
        "--quiet",
        "--async",
        "--format=json"
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode != 0:
        # Si aquí falla, sí es un error al lanzar la operación
        log_event(f"❌ gcloud import falló al lanzar la operación: {proc.stderr}", "ERROR")
        return False, {"stderr": proc.stderr}

    # 2) Parseamos el ID de la operación
    try:
        resp = json.loads(proc.stdout.strip() or "{}")
        # Puede venir como dict o como lista con un elemento
        if isinstance(resp, list) and resp:
            op_name = resp[0].get("name")
        else:
            op_name = resp.get("name")
    except Exception as e:
        log_event(f"❌ No se pudo parsear la respuesta JSON de gcloud: {e}", "ERROR")
        return False, {"error": f"parse_json: {e}", "raw": proc.stdout}

    if not op_name:
        log_event(f"❌ No se obtuvo operation ID en la respuesta de gcloud.", "ERROR")
        return False, {"error": "no_operation_id", "raw": proc.stdout}

    log_event(f"ℹ️ Operation ID para {db_name}: {op_name}")

    # 3) Poll explícito de la operación con describe
    deadline = time.time() + OPERATION_TIMEOUT_SECONDS

    while time.time() < deadline:
        desc_proc = subprocess.run(
            [
                "gcloud", "sql", "operations", "describe", op_name,
                f"--project={GCP_PROJECT}",
                "--format=json"
            ],
            capture_output=True, text=True
        )

        if desc_proc.returncode != 0:
            log_event(f"⚠️ Error al describir operación {op_name}: {desc_proc.stderr}", "WARNING")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        try:
            op = json.loads(desc_proc.stdout)
        except Exception as e:
            log_event(f"⚠️ No se pudo parsear el describe de la operación: {e}", "WARNING")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        status = op.get("status")
        log_event(f"ℹ️ Estado de operación {op_name} ({db_name}): {status}")

        if status == "DONE":
            # Puede venir campo "error" aunque status sea DONE, lo revisamos
            if op.get("error"):
                log_event(f"❌ La operación {op_name} terminó con error: {op['error']}", "ERROR")
                return False, op
            return True, op

        if status in ("FAILED", "ERROR", "CANCELLED"):
            log_event(f"❌ La operación {op_name} terminó con estado {status}", "ERROR")
            return False, op

        # Si sigue RUNNING o PENDING, esperamos
        time.sleep(POLL_INTERVAL_SECONDS)

    # Si salimos del while, se agotó el timeout de nuestro script
    log_event(
        f"❌ Timeout esperando a que termine la operación {op_name} "
        f"para la BD {db_name}. (OPERATION_TIMEOUT_SECONDS={OPERATION_TIMEOUT_SECONDS})",
        "ERROR"
    )
    return False, {"error": "timeout", "operation": op_name}

# ----------------------------------------------------
# Scripts extras
# ----------------------------------------------------
def split_sql_batches(sql_text):
    import re
    return [
        p.strip()
        for p in re.split(r'^\s*GO\s*$', sql_text, flags=re.MULTILINE | re.IGNORECASE)
        if p.strip()
    ]

def run_extra_scripts():
    if not EXTRA_SQL_SCRIPTS_PATH or not os.path.isdir(EXTRA_SQL_SCRIPTS_PATH):
        log_event("ℹ️ No hay scripts extras.", "INFO")
        return

    try:
        conn = pyodbc.connect(
            f"DRIVER={{ODBC Driver 18 for SQL Server}};"
            f"SERVER={DB_HOST};UID={DB_USER};PWD={DB_PASS};"
            f"Encrypt=yes;TrustServerCertificate=yes;",
            autocommit=True
        )
        cursor = conn.cursor()

        for file in sorted(os.listdir(EXTRA_SQL_SCRIPTS_PATH)):
            if not file.lower().endswith(".sql"):
                continue

            full_path = os.path.join(EXTRA_SQL_SCRIPTS_PATH, file)
            log_event(f"📄 Ejecutando script extra: {file}")

            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    sql = f.read()

                for batch in split_sql_batches(sql):
                    cursor.execute(batch)

                log_event(f"✅ Script {file} ejecutado correctamente.")

            except Exception as e:
                log_event(f"❌ Error ejecutando script {file}: {e}", "ERROR")

    except Exception as e:
        log_event(f"❌ Error conectando para scripts extras: {e}", "ERROR")

# ----------------------------------------------------
# MAIN
# ----------------------------------------------------
def main():
    log_event("=== 🔰 Inicio del proceso de restauración ===")

    if not validate_gcloud_account():
        return

    if not test_db_connection_sqlcmd():
        return

    found_baks, metas = validate_backups_in_bucket()
    if not found_baks:
        log_event("❌ No se encontraron backups válidos.", "ERROR")
        return

    missing = [b for b in BACKUP_FILES if b not in found_baks]
    if missing:
        log_event(f"❌ Faltan backups obligatorios: {missing}", "ERROR")
        return

    bak_db_map = build_backup_db_map(found_baks)
    if not bak_db_map:
        return

    existing = list_databases_sqlcmd()
    target_dbs = list(bak_db_map.values())

    log_event(f"🎯 Bases objetivo a eliminar: {target_dbs}")

    if not drop_databases_if_exist(target_dbs, existing):
        log_event("❌ Error eliminando bases. Abortando.", "ERROR")
        return

    # Ejecutar restores
    restore_results = {}

    for bak, db_name in bak_db_map.items():
        blob_full_path = f"{BUCKET_PATH}/{bak}"
        ok, details = run_gcloud_import_and_wait(bak, db_name, blob_full_path)
        restore_results[db_name] = {"ok": ok, "details": details}

        if ok:
            log_event(f"✅ Restauración exitosa de {db_name}")
        else:
            log_event(f"❌ Restauración fallida de {db_name}", "ERROR")

    # Scripts extras solo si TODO salió OK
    all_ok = all(r["ok"] for r in restore_results.values())
    if all_ok:
        log_event("ℹ️ Todas las restauraciones OK. Ejecutando scripts extras...")
        run_extra_scripts()
    else:
        fallidas = [db for db, r in restore_results.items() if not r["ok"]]
        log_event(f"⚠️ No se ejecutarán scripts extras. Fallidas: {fallidas}")

    log_event("=== 🏁 Proceso completado ===")

if __name__ == "__main__":
    main()
