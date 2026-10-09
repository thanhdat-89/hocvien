import { Pool } from 'pg'

const projectRef = 'kpspgmqgemkvxjvaaazw'

let pool: Pool | undefined

/** Private staging database connection. Configure the connection details in the backend environment. */
export function getSupabasePool(): Pool {
  if (!pool) {
    const password = process.env.SUPABASE_DB_PASSWORD
    if (!password) throw new Error('SUPABASE_DB_PASSWORD chưa được cấu hình')

    pool = new Pool({
      host: process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
      port: Number(process.env.SUPABASE_DB_PORT || 6543),
      database: process.env.SUPABASE_DB_NAME || 'postgres',
      user: process.env.SUPABASE_DB_USER || `postgres.${projectRef}`,
      password,
      // Supabase's managed pooler presents a self-signed certificate on this endpoint.
      // Traffic remains TLS-encrypted; credentials are never sent over plaintext.
      ssl: { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    })
  }
  return pool
}
