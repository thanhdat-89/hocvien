// Developer Portal gateway, verified 11/10/2026. No signing/publishing endpoints.
const GATEWAY = 'https://developer.misa.vn/apis'
type Product = 'meinvoice' | 'esign'
const setting = (name: string, alias?: string) => process.env[name]?.trim() || (alias ? process.env[alias]?.trim() : '') || ''

export function misaConnectionConfig(product: Product) {
  const invoice = product === 'meinvoice'
  const fields = invoice ? {
    MEINVOICE_CLIENT_ID: setting('MEINVOICE_CLIENT_ID', 'Client_ID'),
    MEINVOICE_CLIENT_SECRET: setting('MEINVOICE_CLIENT_SECRET', 'Client_Secret'),
    MEINVOICE_TAXCODE: setting('MEINVOICE_TAXCODE', 'taxcode'),
    MEINVOICE_USERNAME: setting('MEINVOICE_USERNAME', 'username'),
    MEINVOICE_PASSWORD: setting('MEINVOICE_PASSWORD', 'password'),
  } : {
    ESIGN_CLIENT_ID: setting('ESIGN_CLIENT_ID'),
    ESIGN_CLIENT_SECRET: setting('ESIGN_CLIENT_SECRET'),
    ESIGN_USERNAME: setting('ESIGN_USERNAME'),
    ESIGN_PASSWORD: setting('ESIGN_PASSWORD'),
  }
  return { fields, missing: Object.entries(fields).filter(([, value]) => !value).map(([key]) => key) }
}

export function misaConnectionStatus() {
  return {
    mode: 'READ_ONLY', publishingEnabled: false,
    products: (['meinvoice', 'esign'] as const).map(product => {
      const { fields, missing } = misaConnectionConfig(product)
      return { product, configured: Object.keys(fields).filter(key => !missing.includes(key)), missing }
    }),
  }
}

function decode(value: unknown): any {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

export async function checkMisaConnection(product: Product, request: typeof fetch = fetch, otp?: { code: string; otpType: 0 | 1 }) {
  const { fields, missing } = misaConnectionConfig(product)
  if (missing.length) return { product, state: 'MISSING_CONFIG', missing }
  const invoice = product === 'meinvoice'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ClientID: fields[invoice ? 'MEINVOICE_CLIENT_ID' : 'ESIGN_CLIENT_ID']!,
    ClientSecret: fields[invoice ? 'MEINVOICE_CLIENT_SECRET' : 'ESIGN_CLIENT_SECRET']!,
  }
  const call = async (path: string, init: RequestInit) => {
    const response = await request(`${GATEWAY}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
    const body = await response.json() as any
    if (!body || typeof body !== 'object') throw new Error('INVALID_RESPONSE')
    return body
  }
  try {
    const login = await call(invoice ? '/itg/meinvoice/invoice/token' : otp ? '/esign/v1/auth/two-factor-auth' : '/esign/v1/auth/login-api', {
      method: 'POST', headers,
      body: JSON.stringify(invoice ? {
        taxcode: fields.MEINVOICE_TAXCODE, username: fields.MEINVOICE_USERNAME, password: fields.MEINVOICE_PASSWORD,
      } : otp ? { userName: fields.ESIGN_USERNAME, code: otp.code, otpType: otp.otpType, remember: false }
        : { userName: fields.ESIGN_USERNAME, password: fields.ESIGN_PASSWORD }),
    })
    const data = decode(login.data ?? login.Data)
    if (invoice && (login.success ?? login.Success) !== true) return { product, state: 'AUTH_FAILED' }
    if (!invoice && Number(login.status?.errorCode) === 122) return { product, state: 'OTP_REQUIRED' }
    if (!invoice && (login.status?.error === true || Number(login.status?.code) !== 200)) return { product, state: otp ? 'OTP_FAILED' : 'AUTH_FAILED' }
    const token = invoice ? data : data?.remoteSigningAccessToken
    if (typeof token !== 'string' || !token) return { product, state: invoice ? 'INVALID_RESPONSE' : 'OTP_REQUIRED' }
    const result = await call(invoice
      ? `/itg/meinvoice/invoice/templates?invoiceWithCode=true&ticket=false&year=${new Date().getFullYear()}`
      : '/esign/v1/certificates/by-userId', {
      method: 'GET', headers: { ...headers, [invoice ? 'Authorization' : 'AuthorizationRM']: `Bearer ${token}` },
    })
    if (invoice && (result.success ?? result.Success) !== true) return { product, state: 'LOOKUP_FAILED' }
    const list = decode(invoice ? (result.data ?? result.Data) : (Array.isArray(result) ? result : result.data))
    if (!Array.isArray(list)) return { product, state: 'INVALID_RESPONSE' }
    // Return counts only. Tokens, raw certificates and provider responses stay server-side.
    return { product, state: 'CONNECTED', count: list.length,
      activeCount: invoice ? list.filter(item => item.Inactive !== true).length : list.filter(item => item.keyStatus === 'ACTIVE').length }
  } catch {
    return { product, state: 'REQUEST_FAILED' }
  }
}
