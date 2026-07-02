# Prompt para Claude Code — Sistema de orquestación de restauración de backups multi-motor

> Pega este bloque completo como primer mensaje en Claude Code, dentro de la carpeta del proyecto.
> Rellena los campos marcados con «...» antes de enviarlo.

---

## 0. Rol y objetivo

Actúa como arquitecto de software senior + DBA especializado en GCP Cloud SQL. Vas a construir un sistema web para **orquestar la restauración de backups en instancias de Cloud SQL de GCP**, soportando tres motores destino: **SQL Server, PostgreSQL y MySQL**.

Responde siempre en **español**, con output técnico directo y sin relleno.

**Regla de arranque:** NO escribas código de aplicación hasta completar la Fase 0 (descubrimiento) y que yo apruebe el plan de la Fase 1.

---

## 1. Fase 0 — Descubrimiento (OBLIGATORIA, antes de todo)

Tengo una carpeta con scripts y archivos que hoy uso para restaurar backups de **SQL Server** en Cloud SQL de GCP.

Ruta de esos scripts: `...`

Tu primer trabajo es **analizarlos sin modificarlos** y producir un informe corto (no vuelques archivos completos, resume):

1. Inventario de archivos: qué hace cada uno, lenguaje, dependencias.
2. Flujo actual de restauración de SQL Server, paso a paso (origen del backup en GCS, comandos `gcloud`/API usados, validaciones, manejo de errores).
3. Parámetros y credenciales: cómo se pasan hoy (variables de entorno, hardcode, archivos de config) y qué riesgos de seguridad existen.
4. Qué lógica es **genérica** (reusable para los 3 motores) y qué es **específica** de SQL Server.
5. Diferencias que anticipas al extender a PostgreSQL y MySQL en Cloud SQL (formato de backup, comandos de import/restore, permisos, dialecto).

Entrega ese informe y **detente**. Espera mi confirmación antes de proponer arquitectura.

---

## 2. Stack técnico (fijo)

- **Runtime:** Node.js 24 LTS, JavaScript ESM (sin TypeScript salvo que lo pida).
- **Backend:** Express.
- **BD de la aplicación:** PostgreSQL 17 (metadata, historial de restauraciones, configuración, usuarios/roles, logs de auditoría).
- **Frontend:** React + Vite.
- **Motores destino soportados:** SQL Server, PostgreSQL, MySQL (todos en Cloud SQL de GCP).
- **Integración GCP:** Cloud SQL Admin API, GCS (origen de backups), autenticación por cuenta de servicio / IAM.

---

## 3. Alcance funcional

La app debe permitir, para cualquiera de los tres motores:

- Listar backups disponibles en GCS.
- Validar un backup antes de restaurar (existencia, tamaño, permisos, formato esperado).
- Lanzar una restauración hacia una instancia Cloud SQL objetivo.
- Seguir el progreso de la operación **en tiempo real** (las restauraciones son largas → trabajo asíncrono, no request bloqueante).
- Registrar historial y auditoría: quién restauró qué, cuándo, a qué instancia, resultado, duración.
- Gestión de instancias/proyectos GCP objetivo desde configuración (no hardcode).

Modelo de proyectos/instancias GCP con los que trabajo: `...`
(Déjalo parametrizable; no lo fijes en código.)

---

## 4. Arquitectura objetivo (propónmela, no la asumas cerrada)

Diseña sobre estos principios y **valídalos conmigo** antes de codificar:

- **Patrón Strategy/Adapter por motor:** interfaz común (`listBackups`, `validateBackup`, `restore`, `getStatus`) con implementaciones `SqlServerAdapter`, `PostgresAdapter`, `MySqlAdapter`. Refactoriza mis scripts actuales dentro de `SqlServerAdapter`.
- **Separación de capas:** rutas/controladores → servicios → adaptadores de motor → capa de acceso a datos parametrizada. Sin lógica de negocio en los controladores.
- **Trabajos asíncronos:** propón mecanismo para operaciones largas (p. ej. cola de jobs o modelo de jobs en PG con SSE/WebSocket para progreso). Justifica la elección.
- **Configuración externa:** todo lo variable (proyectos, instancias, buckets, credenciales) fuera del código.

---

## 5. Requisitos no funcionales (no negociables)

**Seguridad**
- Cero credenciales hardcodeadas. Secretos vía variables de entorno o Secret Manager.
- Toda consulta SQL **parametrizada**; jamás concatenación de strings.
- Validación y sanitización de toda entrada (nombres de bucket, archivos, instancias).
- Principio de menor privilegio en la cuenta de servicio GCP.
- Auditoría persistente de toda operación de restauración.

**Performance**
- Operaciones de BD no bloqueantes; pool de conexiones configurado.
- Restauraciones desacopladas del ciclo request/response.
- Índices adecuados en las tablas de historial/jobs.

**Diseño / Arquitectura**
- Código modular, responsabilidad única, fácil de extender a un cuarto motor sin tocar el core.
- Manejo de errores consistente y tipado (errores de dominio vs errores de infraestructura).
- Logging estructurado.

**Frontend**
- UI clara para lanzar restauraciones, ver estado en vivo e historial.
- Estados de carga, error y éxito bien manejados.

---

## 6. Convenciones de trabajo y eficiencia de tokens

- Mantén un archivo **`CLAUDE.md`** como fuente de verdad del proyecto (stack, arquitectura, decisiones, estado por fase). Actualízalo al cerrar cada fase; no repitas su contenido en cada respuesta.
- **No releas** archivos que ya están en contexto. Usa búsquedas dirigidas (grep) en vez de volcar directorios enteros.
- Prefiere **ediciones quirúrgicas** sobre reescrituras completas de archivos.
- Resume hallazgos; no pegues archivos completos salvo que lo pida.
- Trabaja por fases con **checkpoints**: al terminar una fase, resume qué hiciste y espera visto bueno antes de seguir.
- Respuestas densas y técnicas, sin preámbulos ni cierres de relleno.

---

## 7. Plan de entrega por fases

1. **Fase 0 —** Descubrimiento y análisis de scripts actuales (informe + esperar aprobación).
2. **Fase 1 —** Propuesta de arquitectura + estructura de carpetas + esquema de PostgreSQL 17 (esperar aprobación).
3. **Fase 2 —** Core backend: capa de acceso a datos, interfaz de adaptadores, `SqlServerAdapter` (migrando mis scripts), jobs asíncronos.
4. **Fase 3 —** `PostgresAdapter` y `MySqlAdapter`.
5. **Fase 4 —** Frontend React (lanzar restauración, progreso en vivo, historial).
6. **Fase 5 —** Hardening de seguridad, tests, documentación final en `CLAUDE.md`.

Al final de cada fase: resumen breve + siguiente paso propuesto. No avances de fase sin confirmación.

---

## 8. Reglas de oro

- No inventes credenciales, nombres de instancias ni rutas: si falta un dato, **pregúntame**.
- No modifiques mis scripts originales en la Fase 0; solo analízalos.
- Ante cualquier duda de diseño con impacto en seguridad o arquitectura, **propón opciones y pregunta** antes de implementar.

**Empieza ahora por la Fase 0.**
