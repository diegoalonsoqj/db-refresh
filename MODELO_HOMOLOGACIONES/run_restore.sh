#!/bin/bash

# Ruta del proyecto
PROJECT_DIR="/SCRIPTS/MSSQL/AJAX"

# Entrar al directorio del proyecto
cd "$PROJECT_DIR" || exit 1

# Activar entorno virtual
source venv-ajax/bin/activate

# Ejecutar el script Python
python restore_to_csql.py >> Logs/cron.log 2>&1
#python validate_restore.py >> Logs/cron.log 2>&1
