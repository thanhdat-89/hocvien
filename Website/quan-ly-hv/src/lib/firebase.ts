import admin from 'firebase-admin'

// ─── Khởi tạo Firebase Admin SDK ──────────────────────────────
// Cần service account key. Tải về từ:
// Firebase Console → Project Settings → Service Accounts → Generate new private key
// Lưu file JSON vào gốc project với tên: firebase-service-account.json
// HOẶC set biến môi trường: FIREBASE_SERVICE_ACCOUNT_JSON='{...json content...}'

const PROJECT_ID = 'hocthemtoan-7ecb8'
const DATABASE_URL = 'https://hocthemtoan-7ecb8-default-rtdb.asia-southeast1.firebasedatabase.app'

if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON

  if (serviceAccountJson) {
    // Từ biến môi trường (khuyến nghị cho production)
    try {
      const parsed = JSON.parse(serviceAccountJson)
      admin.initializeApp({
        credential: admin.credential.cert(parsed as admin.ServiceAccount),
        databaseURL: DATABASE_URL,
        projectId: PROJECT_ID,
      })
    } catch (e) {
      console.error('[Firebase] Lỗi parse FIREBASE_SERVICE_ACCOUNT_JSON:', e)
      throw e
    }
  } else {
    // Từ file local (cho development)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serviceAccount = require('../../firebase-service-account.json') as admin.ServiceAccount
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: DATABASE_URL,
        projectId: PROJECT_ID,
      })
    } catch {
      // Application Default Credentials (khi deploy trên Google Cloud)
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: DATABASE_URL,
        projectId: PROJECT_ID,
      })
    }
  }
}

export const db = admin.firestore()
db.settings({ ignoreUndefinedProperties: true })
export { admin }

// ─── Collection names ─────────────────────────────────────────
export const C = {
  USERS:               'users',
  TEACHERS:            'teachers',
  STUDENTS:            'students',
  SUBJECTS:            'subjects',
  CLASSES:             'classes',
  ENROLLMENTS:         'classEnrollments',
  SCHEDULES:           'schedules',
  SESSIONS:            'sessions',
  STUDENT_ATTENDANCES: 'studentAttendances',
  TEACHER_ATTENDANCES: 'teacherAttendances',
  TUITION_RECORDS:     'tuitionRecords',
  PAYMENTS:            'payments',
  PROMOTIONS:          'promotions',
  STUDENT_PROMOTIONS:  'studentPromotions',
  HOLIDAYS:            'holidays',
  NOTIFICATIONS:       'notifications',
  LEADS:               'leads',
  PRIVATE_SCHEDULES:   'privateSchedules',
  TESTS:               'tests',
  MATERIALS:           'materials',
  AGGREGATES:          'aggregates',
} as const

// Firebase Storage bucket — dùng default bucket {project}.appspot.com
export const storageBucket = admin.storage().bucket(`${PROJECT_ID}.appspot.com`)

// ─── Helpers ──────────────────────────────────────────────────

/** Chuyển Firestore document sang plain object có field `id` */
export function toObj<T>(doc: admin.firestore.DocumentSnapshot): T & { id: string } {
  const data = doc.data() || {}
  // Convert Firestore Timestamps → ISO strings
  const converted = convertTimestamps(data)
  return { id: doc.id, ...converted } as T & { id: string }
}

/** Chuyển Firestore QuerySnapshot sang mảng */
export function toDocs<T>(snapshot: admin.firestore.QuerySnapshot): (T & { id: string })[] {
  return snapshot.docs.map(doc => toObj<T>(doc))
}

/** Đệ quy chuyển Firestore.Timestamp sang ISO string */
function convertTimestamps(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (val instanceof admin.firestore.Timestamp) {
      result[key] = val.toDate().toISOString()
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = convertTimestamps(val as Record<string, unknown>)
    } else {
      result[key] = val
    }
  }
  return result
}

/** Phân trang in-memory (phù hợp dataset nhỏ < 10k bản ghi) */
export function paginate<T>(arr: T[], page: number, limit: number) {
  const total = arr.length
  const data = arr.slice((page - 1) * limit, page * limit)
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

/** Chuyển giá trị sang Firestore Timestamp */
export function toTimestamp(val: string | Date | undefined): admin.firestore.Timestamp | undefined {
  if (!val) return undefined
  const d = typeof val === 'string' ? new Date(val) : val
  return admin.firestore.Timestamp.fromDate(d)
}

/** Server timestamp */
export const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp()

/** Ép kiểu string | string[] → string (Express 5 route params) */
export const s = (val: string | string[]): string => Array.isArray(val) ? val[0] : val
