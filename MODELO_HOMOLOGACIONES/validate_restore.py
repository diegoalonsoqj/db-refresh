import os
import subprocess
import pyodbc
import logging
from datetime import datetime
from dotenv import load_dotenv
from google.cloud import storage

# =========================================================
# 1️⃣ Cargar variables del entorno
# =========================================================
load_dotenv()

BUCKET_PATH = os.getenv("BUCKET_PATH")
GCP_PROJECT = os.getenv("GCP_PROJECT")
GCP_INSTANCE = os.getenv("GCP_INSTANCE")
GCP_KEY_PATH = os.getenv("GCP_KEY_PATH")

DB_HOST = os.getenv("DB_HOST")
DB_USER = os.getenv("DB_USER")
DB_PASS = os.getenv("DB_PASS")
DB_NAMES = [db.strip() for db in os.getenv("DB_NAMES", "").split(",")]

BACKUP_FILES = [b.strip() for b in os.getenv("BACKUP_FILES", "").split(",")]
EXTRA_SQL_SCRIPTS_PATH = os.getenv("EXTRA_SQL_SCRIPTS_PATH")

LOG_PATH = os.getenv("LOG_PATH")

# =========================================================
# 2️⃣ Configurar logging
# =========================================================
logging.basicConfig(
    filename=LOG_PATH,
    filemode="a",
    encoding="utf-8",
    format="%(message)s",
    level=logging.INFO
)

def log_event(event):
    timestamp = datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
    msg = f"{timestamp} - {event}"
    logging.info(msg)
    print(msg)

# =========================================================
# 3️⃣ Validar conexión SQL Server
# =========================================================
def validate_connection():
    conn_str = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={DB_HOST};"
        f"UID={DB_USER};"
        f"PWD={DB_PASS};"
        "Encrypt=yes;"
        "TrustServerCertificate=yes;"
    )
    try:
        with pyodbc.connect(conn_str, timeout=5) as conn:
            log_event("✅ Conexión exitosa con SQL Server.")
            return True
    except Exception as e:
        log_event(f"❌ Error al conectar con SQL Server: {e}")
        return False

# =========================================================
# 4️⃣ Validar permisos SQL del usuario
# =========================================================
def validate_permissions():
    try:
        conn_str = (
            "DRIVER={ODBC Driver 18 for SQL Server};"
            f"SERVER={DB_HOST};"
            f"UID={DB_USER};"
            f"PWD={DB_PASS};"
            "Encrypt=yes;"
            "TrustServerCertificate=yes;"
        )
        with pyodbc.connect(conn_str) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    IS_MEMBER('dbcreator') AS dbcreator,
                    IS_SRVROLEMEMBER('sysadmin') AS sysadmin;
            """)
            row = cursor.fetchone()

            if row.sysadmin == 1 or row.dbcreator == 1:
                log_event("🔐 Permisos SQL adecuados (sysadmin/dbcreator).")
            else:
                log_event("⚠️ El usuario NO tiene permisos suficientes para restaurar bases.")
    except Exception as e:
        log_event(f"❌ Error validando permisos del usuario: {e}")

# =========================================================
# 5️⃣ Validar existencia de bases en la instancia
# =========================================================
def validate_databases():
    existing = []
    missing = []

    try:
        conn_str = (
            "DRIVER={ODBC Driver 18 for SQL Server};"
            f"SERVER={DB_HOST};"
            f"UID={DB_USER};"
            f"PWD={DB_PASS};"
            "Encrypt=yes;"
            "TrustServerCertificate=yes;"
        )
        with pyodbc.connect(conn_str) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sys.databases;")
            dbs = [row[0].lower() for row in cursor.fetchall()]

            for db in DB_NAMES:
                if db.lower() in dbs:
                    existing.append(db)
                else:
                    missing.append(db)

            log_event(f"📚 Bases encontradas: {existing or 'Ninguna'}")

            if missing:
                log_event(f"⚠️ Bases NO encontradas: {missing}")
    except Exception as e:
        log_event(f"❌ Error validando bases existentes: {e}")

# =========================================================
# 6️⃣ Validar archivos .bak en Cloud Storage + tamaño
# =========================================================
def validate_backups():
    try:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = GCP_KEY_PATH
        client = storage.Client.from_service_account_json(GCP_KEY_PATH)

        bucket_name = BUCKET_PATH.split("/")[2]
        path_prefix = "/".join(BUCKET_PATH.split("/")[3:])

        blobs = list(client.list_blobs(bucket_name, prefix=path_prefix))
        blob_names = [b.name.split("/")[-1] for b in blobs]

        for bak in BACKUP_FILES:
            if bak in blob_names:
                # obtener blob real
                blob = next(b for b in blobs if b.name.endswith(bak))
                size_mb = blob.size / (1024 * 1024)
                log_event(f"📦 {bak} encontrado | Tamaño: {size_mb:.2f} MB | Últ. modif: {blob.updated}")
            else:
                log_event(f"❌ .bak NO encontrado en el bucket: {bak}")

    except Exception as e:
        log_event(f"❌ Error validando backups en Cloud Storage: {e}")

# =========================================================
# 7️⃣ Validar que NO haya operaciones activas de Cloud SQL
# =========================================================
def validate_cloudsql_status():
    try:
        cmd = [
            "gcloud", "sql", "operations", "list",
            f"--instance={GCP_INSTANCE}",
            f"--project={GCP_PROJECT}",
            "--format=value(state)"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)

        if "RUNNING" in result.stdout:
            log_event("⚠️ Cloud SQL tiene una operación en curso (posible restore en progreso).")
        else:
            log_event("☑️ Cloud SQL sin operaciones activas.")
    except Exception as e:
        log_event(f"❌ Error consultando Cloud SQL: {e}")

# =========================================================
# 🚀 MAIN
# =========================================================
if __name__ == "__main__":
    log_event("=== 🔍 INICIO DE VALIDACIÓN DE ENTORNO ===")

    if not validate_connection():
        log_event("❌ No se puede continuar sin conexión a SQL Server.")
        exit(1)

    validate_permissions()
    validate_databases()
    validate_backups()
    validate_cloudsql_status()

    if os.path.isdir(EXTRA_SQL_SCRIPTS_PATH):
        log_event("📁 Carpeta de scripts extras encontrada.")
    else:
        log_event(f"⚠️ Carpeta de scripts extras NO encontrada: {EXTRA_SQL_SCRIPTS_PATH}")

    log_event("=== ✅ VALIDACIÓN COMPLETADA ===")
