// Lectura de la cabecera ("prelude") de un archivo de `mongodump --archive`, para
// saber qué BD y colecciones trae sin descargarlo entero. Formato (mongo-tools,
// archive/prelude.go):
//   int32 LE magic 0x8199e26d · documento BSON de cabecera (versión, servidor, tool)
//   · un documento BSON por namespace { db, collection, metadata, size, type }
//   · terminador int32 0xFFFFFFFF · cuerpo (bloques de documentos).
// Con `--gzip` todo el archivo va comprimido: se lee a través de gunzip.
import { createGunzip } from 'node:zlib';
import { BSON } from 'mongodb';
import { DomainError } from '../../domain/errors.js';

export const ARCHIVE_MAGIC = 0x8199e26d;
const TERMINATOR = 0xffffffff;
// La cabecera ocupa unos pocos KB; un tope evita leer un archivo corrupto entero.
const MAX_PRELUDE_BYTES = 64 * 1024 * 1024;

/**
 * Interpreta la cabecera a partir de los primeros bytes del archivo (ya descomprimidos).
 * -> { done: false } si faltan bytes, o { done: true, header, namespaces: [{ db, collection, type }] }.
 * Lanza si no es un archivo de mongodump.
 */
export function parsePrelude(buf) {
  if (buf.length < 4) return { done: false };
  if (buf.readUInt32LE(0) !== ARCHIVE_MAGIC) {
    throw new DomainError('El archivo no es un volcado de mongodump --archive (cabecera desconocida)', { code: 'BAD_FORMAT' });
  }
  let pos = 4;
  let header = null;
  const namespaces = [];
  for (;;) {
    if (buf.length < pos + 4) return { done: false };
    const len = buf.readUInt32LE(pos);
    if (len === TERMINATOR) return { done: true, header, namespaces };
    if (len < 5 || len > 16 * 1024 * 1024) {
      throw new DomainError('Cabecera del archivo de mongodump corrupta', { code: 'BAD_FORMAT' });
    }
    if (buf.length < pos + len) return { done: false };
    const doc = BSON.deserialize(buf.subarray(pos, pos + len));
    if (header === null) header = doc;
    else namespaces.push({ db: doc.db, collection: doc.collection, type: doc.type ?? 'collection' });
    pos += len;
  }
}

/**
 * Lee la cabecera de un archivo desde un stream (GCS) y lo cierra en cuanto la tiene.
 * @param source Readable con el archivo tal cual está en el bucket
 * @param gzip   true si es `.archive.gz`
 */
export function readArchivePrelude(source, { gzip }) {
  return new Promise((resolve, reject) => {
    const input = gzip ? source.pipe(createGunzip()) : source;
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      source.destroy();
      if (input !== source) input.destroy();
      fn();
    };
    const fail = (err) => finish(() => reject(err instanceof DomainError ? err
      : new DomainError(`No se pudo leer la cabecera del archivo: ${err.message}`, { code: 'BAD_FORMAT', cause: err })));

    input.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      try {
        const res = parsePrelude(Buffer.concat(chunks, size));
        if (res.done) finish(() => resolve({ header: res.header, namespaces: res.namespaces }));
        else if (size > MAX_PRELUDE_BYTES) fail(new DomainError('Cabecera del archivo de mongodump demasiado grande', { code: 'BAD_FORMAT' }));
      } catch (err) {
        fail(err);
      }
    });
    input.on('error', fail);
    if (input !== source) source.on('error', fail);
    input.on('end', () => fail(new DomainError('El archivo termina antes de completar su cabecera', { code: 'BAD_FORMAT' })));
  });
}
