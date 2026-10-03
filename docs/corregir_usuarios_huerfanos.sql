/* =====================================================================
   Corrección de usuarios huérfanos tras restore PROD -> ambiente menor
   SQL Server 2012+ / Cloud SQL for SQL Server
   Aplica a UNA sola base de datos (definida en @BaseDatos).

   - Detecta usuarios de BD cuyo SID no existe en sys.server_principals.
   - Si existe un login con el mismo nombre  -> ALTER USER ... WITH LOGIN
   - Si NO existe el login                   -> lo omite (no falla) o,
     con @CrearLoginsFaltantes = 1, crea el login con el MISMO SID
     (password aleatorio y DESHABILITADO) para conservar permisos.
   - Cada acción va en TRY/CATCH: un error no detiene el resto.
   - Opcional: corrige el owner huérfano de la BD.
   ===================================================================== */
SET NOCOUNT ON;

DECLARE @BaseDatos            sysname = N'NombreDeTuBD';  -- <<< BD a corregir
DECLARE @Ejecutar             bit     = 0;     -- 0 = solo reporta (dry run) | 1 = aplica cambios
DECLARE @CrearLoginsFaltantes bit     = 0;     -- 1 = crea logins faltantes con el mismo SID
DECLARE @OwnerBD              sysname = NULL;  -- login para owner huérfano de la BD (NULL = no tocar)

/* ---------- Validación de la BD ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.databases
               WHERE name = @BaseDatos AND state_desc = 'ONLINE' AND is_read_only = 0)
BEGIN
    RAISERROR('La BD [%s] no existe, no está ONLINE o es de solo lectura.', 16, 1, @BaseDatos);
    RETURN;
END

IF OBJECT_ID('tempdb..#Orfanos')   IS NOT NULL DROP TABLE #Orfanos;
IF OBJECT_ID('tempdb..#Resultado') IS NOT NULL DROP TABLE #Resultado;

CREATE TABLE #Orfanos (
    Usuario    sysname,
    Tipo       char(1),
    SidUsuario varbinary(85)
);

CREATE TABLE #Resultado (
    Usuario sysname,
    Tipo    char(1),
    Accion  nvarchar(200),
    Estado  varchar(20),
    Detalle nvarchar(4000)
);

-- Ejecuta todo en el contexto de la BD indicada
DECLARE @proc nvarchar(300) = QUOTENAME(@BaseDatos) + N'.sys.sp_executesql';

DECLARE @sqlDetectar nvarchar(max) = N'
INSERT #Orfanos (Usuario, Tipo, SidUsuario)
SELECT dp.name, dp.type, dp.sid
FROM sys.database_principals dp
LEFT JOIN sys.server_principals sp ON sp.sid = dp.sid
WHERE dp.type IN (''S'',''U'',''G'')          -- SQL user, Windows user, Windows group
  AND dp.authentication_type IN (1,3)         -- 1 = login de instancia, 3 = Windows (excluye contained y WITHOUT LOGIN)
  AND dp.principal_id > 4                     -- excluye dbo, guest, INFORMATION_SCHEMA, sys
  AND dp.name NOT LIKE ''##%''
  AND sp.sid IS NULL;';

DECLARE @u sysname, @tipo char(1), @sid varbinary(85),
        @accion nvarchar(200), @cmd nvarchar(max), @cmdLog nvarchar(max), @ownerSid varbinary(85);

/* ---------- Detección ---------- */
BEGIN TRY
    EXEC @proc @sqlDetectar;
END TRY
BEGIN CATCH
    INSERT #Resultado VALUES (N'-', NULL, N'Detección', 'ERROR', ERROR_MESSAGE());
END CATCH

/* ---------- Usuarios huérfanos ---------- */
DECLARE cur_u CURSOR LOCAL FAST_FORWARD FOR
    SELECT Usuario, Tipo, SidUsuario FROM #Orfanos;

OPEN cur_u;
FETCH NEXT FROM cur_u INTO @u, @tipo, @sid;

WHILE @@FETCH_STATUS = 0
BEGIN
    SELECT @cmd = NULL, @cmdLog = NULL;

    IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @u)
    BEGIN
        SET @accion = N'Remapear a login existente';
        SET @cmd    = N'ALTER USER ' + QUOTENAME(@u) + N' WITH LOGIN = ' + QUOTENAME(@u) + N';';
        SET @cmdLog = @cmd;
    END
    ELSE IF @CrearLoginsFaltantes = 1 AND @tipo = 'S'
    BEGIN
        SET @accion = N'Crear login SQL (mismo SID, deshabilitado)';
        SET @cmd = N'CREATE LOGIN ' + QUOTENAME(@u)
                 + N' WITH PASSWORD = N''' + CONVERT(nvarchar(64), CRYPT_GEN_RANDOM(24), 2) + N'aA1!'''
                 + N', SID = ' + CONVERT(nvarchar(200), @sid, 1)
                 + N', CHECK_POLICY = OFF, DEFAULT_DATABASE = ' + QUOTENAME(@BaseDatos) + N'; '
                 + N'ALTER LOGIN ' + QUOTENAME(@u) + N' DISABLE;';
        SET @cmdLog = N'CREATE LOGIN ' + QUOTENAME(@u) + N' WITH PASSWORD = ''****'', SID = '
                    + CONVERT(nvarchar(200), @sid, 1) + N' ... DISABLE';
    END
    ELSE IF @CrearLoginsFaltantes = 1 AND @tipo IN ('U','G')
    BEGIN
        SET @accion = N'Crear login Windows';
        SET @cmd    = N'CREATE LOGIN ' + QUOTENAME(@u) + N' FROM WINDOWS WITH DEFAULT_DATABASE = ' + QUOTENAME(@BaseDatos) + N';';
        SET @cmdLog = @cmd;
    END
    ELSE
        SET @accion = N'Login no existe en esta instancia: omitido';

    IF @cmd IS NULL
        INSERT #Resultado VALUES (@u, @tipo, @accion, 'OMITIDO', NULL);
    ELSE IF @Ejecutar = 0
        INSERT #Resultado VALUES (@u, @tipo, @accion, 'PENDIENTE', @cmdLog);
    ELSE
    BEGIN
        BEGIN TRY
            EXEC @proc @cmd;
            INSERT #Resultado VALUES (@u, @tipo, @accion, 'OK', @cmdLog);
        END TRY
        BEGIN CATCH
            INSERT #Resultado VALUES (@u, @tipo, @accion, 'ERROR', ERROR_MESSAGE());
        END CATCH
    END

    FETCH NEXT FROM cur_u INTO @u, @tipo, @sid;
END

CLOSE cur_u;
DEALLOCATE cur_u;

/* ---------- Owner huérfano de la BD ---------- */
SELECT @ownerSid = owner_sid FROM sys.databases WHERE name = @BaseDatos;

IF SUSER_SNAME(@ownerSid) IS NULL
BEGIN
    IF @OwnerBD IS NULL
        INSERT #Resultado VALUES (N'dbo', NULL, N'Owner de BD huérfano', 'OMITIDO', N'Defina @OwnerBD para corregir');
    ELSE
    BEGIN
        SET @cmd = N'ALTER AUTHORIZATION ON DATABASE::' + QUOTENAME(@BaseDatos) + N' TO ' + QUOTENAME(@OwnerBD) + N';';
        IF @Ejecutar = 0
            INSERT #Resultado VALUES (N'dbo', NULL, N'Cambiar owner de BD', 'PENDIENTE', @cmd);
        ELSE
        BEGIN
            BEGIN TRY
                EXEC (@cmd);
                INSERT #Resultado VALUES (N'dbo', NULL, N'Cambiar owner de BD', 'OK', @cmd);
            END TRY
            BEGIN CATCH
                INSERT #Resultado VALUES (N'dbo', NULL, N'Cambiar owner de BD', 'ERROR', ERROR_MESSAGE());
            END CATCH
        END
    END
END

/* ---------- Reporte ---------- */
SELECT @BaseDatos AS BaseDatos, Usuario, Tipo, Accion, Estado, Detalle
FROM #Resultado
ORDER BY Estado, Usuario;

SELECT Estado, COUNT(*) AS Total
FROM #Resultado
GROUP BY Estado;
