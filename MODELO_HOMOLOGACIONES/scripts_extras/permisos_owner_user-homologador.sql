PRINT 'Ejecutando job de permisos (Homologación)';

EXEC msdb.dbo.sp_start_job @job_name = 'Permisos - Homologacion';

PRINT 'Job lanzado correctamente';
GO