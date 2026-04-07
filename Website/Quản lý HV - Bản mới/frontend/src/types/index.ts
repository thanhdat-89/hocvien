export interface User {
  userId: string
  username: string
  fullName: string
  role: 'ADMIN' | 'STAFF' | 'TEACHER'
}

export interface Student {
  id: string
  fullName: string
  dateOfBirth?: string | null
  gender?: string | null
  school?: string | null
  gradeLevel?: number | null
  address?: string | null
  enrollmentDate: string
  status: 'ACTIVE' | 'INACTIVE' | 'RESERVED'
  notes?: string | null
  createdAt: string
  updatedAt: string
  primaryParent?: Parent | null
  enrollments?: ClassEnrollment[]
}

export interface Parent {
  id: string
  studentId: string
  fullName: string
  relationship?: string
  phone?: string
  zalo?: string
  email?: string
  isPrimaryContact: boolean
}

export interface ClassEnrollment {
  id: string
  classId: string
  className: string
  studentId: string
  studentName: string
  enrollmentDate: string
  status: 'ACTIVE' | 'DROPPED'
  customTuitionRate?: number
  notes?: string
  createdAt: string
}

export interface Class {
  id: string
  name: string
  subjectId: string
  subjectName: string
  teacherId: string
  teacherName: string
  gradeLevel?: number
  tuitionRate: number
  sessionsPerMonth: number
  room?: string
  startDate: string
  endDate?: string | null
  status: 'ACTIVE' | 'CLOSED'
  notes?: string
  createdAt: string
}

export interface Teacher {
  id: string
  fullName: string
  phone?: string
  email?: string
  specialization?: string
  salaryPerSession: number
  status: 'ACTIVE' | 'INACTIVE'
  userId?: string
  createdAt: string
}

export interface Session {
  id: string
  classId: string
  className: string
  teacherId: string
  teacherName: string
  sessionDate: string
  startTime: string
  endTime: string
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  notes?: string
  cancelReason?: string
  createdAt: string
  updatedAt: string
}

export interface TuitionRecord {
  id: string
  studentId: string
  studentName: string
  classId: string
  className: string
  billingMonth: number
  billingYear: number
  totalSessions: number
  attendedSessions: number
  ratePerSession: number
  baseAmount: number
  discountAmount: number
  finalAmount: number
  paidAmount: number
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERPAID'
  dueDate?: string
  createdAt: string
  updatedAt: string
}

export interface Payment {
  id: string
  tuitionRecordId: string
  studentId: string
  studentName: string
  classId: string
  amount: number
  paymentDate: string
  method: 'CASH' | 'BANK_TRANSFER' | 'MOMO' | 'ZALOPAY'
  receivedByName: string
  notes?: string
  createdAt: string
}

export interface PrivateSession {
  id: string
  studentId: string
  sessionDate: string
  startTime?: string
  endTime?: string
  ratePerSession: number
  status: string
  notes?: string
}

export interface StudentPromotion {
  id: string
  studentId: string
  classId: string
  className: string
  promotionName: string
  promotionType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SESSIONS'
  promotionValue: number
  appliedFrom: string
  appliedTo?: string
  notes?: string
  createdAt: string
}

export interface TeacherAttendance {
  id: string
  teacherId: string
  teacherName: string
  sessionId: string
  classId: string
  className: string
  sessionDate: string
  status: 'PRESENT' | 'ABSENT' | 'SUBSTITUTED'
  salaryAmount: number
  notes?: string
}

export interface DashboardStats {
  totalStudents: number
  activeStudents: number
  totalClasses: number
  activeClasses: number
  monthlyRevenue: number
  collectedRevenue: number
  sessionsToday: number
  overdueCount: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
