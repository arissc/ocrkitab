import mysql from 'mysql2/promise'

export let dbPool = null
export let dbReady = false
export let dbError = null
export const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'reader_app'
}

export async function initMySql() {
  try {
    const serverConn = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password
    })
    await serverConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
    await serverConn.end()

    dbPool = await mysql.createPool({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    })

    const createMaster = `
      CREATE TABLE IF NOT EXISTS master_kitab (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama_kitab VARCHAR(255) NOT NULL,
        pengarang VARCHAR(255),
        keterangan TEXT,
        folder_path VARCHAR(1024),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `
    const createTerjemahan = `
      CREATE TABLE IF NOT EXISTS kitab_terjemahan (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        id_kitab INT NOT NULL,
        text_original MEDIUMTEXT NOT NULL,
        text_translate MEDIUMTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_kitab) REFERENCES master_kitab(id)
          ON UPDATE CASCADE ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `
    await dbPool.query(createMaster)
    await dbPool.query(createTerjemahan)

    // Safety: ensure folder_path column exists (for older DBs)
    try {
      const [colRows] = await dbPool.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'master_kitab' AND COLUMN_NAME = 'folder_path'`,
        [dbConfig.database]
      )
      if (colRows && colRows[0] && Number(colRows[0].cnt) === 0) {
        await dbPool.query(`ALTER TABLE master_kitab ADD COLUMN folder_path VARCHAR(1024) NULL`)
      }
    } catch (e) {
      console.warn('[DB] Could not verify/add folder_path column:', e.message)
    }

    dbReady = true
    dbError = null
    console.log(`[DB] Connected: ${dbConfig.user}@${dbConfig.host}/${dbConfig.database}`)
  } catch (e) {
    dbReady = false
    dbError = e.message
    console.error('[DB] Initialization error:', e)
  }
}

export function getDbStatus() {
  return { ok: dbReady, error: dbError, config: { host: dbConfig.host, user: dbConfig.user, database: dbConfig.database } }
}

export async function ensureMasterKitab(nama) {
  if (!dbPool) throw new Error('Database not ready')
  const [rows] = await dbPool.query('SELECT id FROM master_kitab WHERE nama_kitab = ? LIMIT 1', [nama])
  if (rows && rows.length > 0) return rows[0].id
  const [res] = await dbPool.query('INSERT INTO master_kitab (nama_kitab) VALUES (?)', [nama])
  return res.insertId
}

export async function listKitabs() {
  if (!dbReady) throw new Error('Database not ready')
  const [rows] = await dbPool.query(
    'SELECT id, nama_kitab, pengarang, keterangan, folder_path, created_at FROM master_kitab ORDER BY created_at DESC, id DESC'
  )
  return rows
}

export async function findKitabByFolder(folderPath) {
  if (!dbReady) throw new Error('Database not ready')
  const [rows] = await dbPool.query(
    'SELECT id, nama_kitab, pengarang, keterangan, folder_path, created_at FROM master_kitab WHERE folder_path = ? LIMIT 1',
    [folderPath]
  )
  return rows && rows.length > 0 ? rows[0] : null
}

export async function createKitab({ nama_kitab, pengarang, keterangan, folder_path }) {
  if (!dbReady) throw new Error('Database not ready')
  const [res] = await dbPool.query(
    'INSERT INTO master_kitab (nama_kitab, pengarang, keterangan, folder_path) VALUES (?, ?, ?, ?)',
    [nama_kitab || '', pengarang || '', keterangan || '', folder_path || null]
  )
  return { id: res.insertId }
}

export async function getTranslation(kitabName, originalText) {
  if (!dbReady) throw new Error('Database not ready')
  const idKitab = await ensureMasterKitab(kitabName)
  const [rows] = await dbPool.query(
    'SELECT id, text_original, text_translate FROM kitab_terjemahan WHERE id_kitab = ? AND text_original = ? LIMIT 1',
    [idKitab, originalText]
  )
  return rows && rows.length > 0 ? rows[0] : null
}

export async function saveTranslation(kitabName, originalText, translatedText) {
  if (!dbReady) throw new Error('Database not ready')
  const idKitab = await ensureMasterKitab(kitabName)
  const [rows] = await dbPool.query(
    'SELECT id FROM kitab_terjemahan WHERE id_kitab = ? AND text_original = ? LIMIT 1',
    [idKitab, originalText]
  )
  if (rows && rows.length > 0) {
    const id = rows[0].id
    await dbPool.query('UPDATE kitab_terjemahan SET text_translate = ? WHERE id = ?', [translatedText || '', id])
    return { action: 'update', id }
  } else {
    const [res] = await dbPool.query(
      'INSERT INTO kitab_terjemahan (id_kitab, text_original, text_translate) VALUES (?, ?, ?)',
      [idKitab, originalText, translatedText || '']
    )
    return { action: 'insert', id: res.insertId }
  }
}