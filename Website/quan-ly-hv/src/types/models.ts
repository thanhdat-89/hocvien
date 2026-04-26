// =============================================================
// TypeScript interfaces cho dữ liệu Firestore
// =============================================================

export type Role = 'ADMIN' | 'TEACHER' | 'STAFF'
export type Gender = 'MALE' | 'FEMALE' | 'OTHER'
export type Relationship = 'FATHER' | 'MOTHER' | 'GUARDIAN'
export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED'
export type TeacherStatus = 'ACTIVE' | 'INACTIVE'
export type ClassStatus = 'ACTIVE' | 'INACTIVE' | 'CLOSED'
export type EnrollmentStatus = 'ACTIVE' | 'DROPPED' | 'ON_LEAVE'
export type SessionStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'MAKEUP'
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
export type TeacherAttendanceStatus = 'PRESENT' | 'ABSENT' | 'SUBSTITUTE'
export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SESSIONS'
export type TuitionStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'MOMO' | 'OTHER'
export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

export interface User {
  id: string
  username: string
  passwordHash: string
  role: Role
  fullName: string
  email?: string
  isActive: boolean
  teacherId?: string
  createdAt: string
  updatedAt: string
}

export interface Teacher {
  id: string
  userId?: string
  fullName: string
  phone?: string
  email?: string
  address?: string
  dateOfBirth?: string
  idCard?: string
  bankAccount?: string
  bankName?: string
  salaryRatePerSession: number
  status: TeacherStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface Student {
  id: string
  fullName: string
  dateOfBirth?: string
  gender?: Gender
  school?: string
  gradeLevel?: number
  address?: string
  enrollmentDate: string
  status: StudentStatus
  avatarUrl?: string
  notes?: string
  // Denorm từ subcollection parents (primary contact) — dùng cho list view
  primaryParentName?: string | null
  primaryParentPhone?: string | null
  primaryParentZalo?: string | null
  createdAt: string
  updatedAt: string
}

export interface Parent {
  id: string
  studentId: string
  fullName: string
  relationship: Relationship
  phone?: string
  zalo?: string
  email?: string
  isPrimaryContact: boolean
  createdAt: string
}

export interface Subject {
  id: string
  name: string
  gradeLevel?: number
  tuitionRatePerSession: number
  description?: string
  isActive: boolean
  createdAt: string
}

export interface Class {
  id: string
  name: string
  subjectId?: string
  subjectName?: string            // denormalized
  teacherId?: string
  teacherName?: string            // denormalized
  room?: string
  maxStudents?: number
  tuitionRate?: number
  sessionsPerMonth?: number
  gradeLevel?: number
  startDate?: string
  endDate?: string
  status: ClassStatus
  notes?: string
  // Denorm: số HV đang ACTIVE trong lớp — cập nhật qua recountClassActiveStudents
  activeStudentCount?: number
  createdAt: string
  updatedAt: string
}

export interface ClassEnrollment {
  id: string
  classId: string
  className: string               // denormalized
  studentId: string
  studentName: string             // denormalized
  enrollmentDate: string
  dropDate?: string
  status: EnrollmentStatus
  customTuitionRate?: number
  notes?: string
  createdAt: string
}

export interface Schedule {
  id: string
  classId: string
  className: string               // denormalized
  dayOfWeek: DayOfWeek
  startTime: string               // "08:00"
  endTime: string                 // "10:00"
  effectiveFrom: string
  effectiveTo?: string
  createdAt: string
}

export interface Session {
  id: string
  classId: string
  className: string               // denormalized
  teacherId: string
  teacherName: string             // denormalized
  scheduleId?: string
  sessionDate: string             // ISO date string
  startTime: string
  endTime: string
  status: SessionStatus
  cancelReason?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface PrivateSession {
  id: string
  studentId: string
  studentName: string
  sessionDate: string       // "YYYY-MM-DD"
  startTime?: string        // "HH:MM"
  endTime?: string          // "HH:MM"
  teacherName?: string
  ratePerSession: number
  status: SessionStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface StudentAttendance {
  id: string
  sessionId: string
  sessionDate: string             // denormalized — dùng để query theo tháng
  classId: string
  className: string               // denormalized
  studentId: string
  studentName: string             // denormalized
  status: AttendanceStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface TeacherAttendance {
  id: string
  sessionId: string
  sessionDate: string             // denormalized
  classId: string
  className: string               // denormalized
  teacherId: string
  teacherName: string             // denormalized
  status: TeacherAttendanceStatus
  substituteTeacherId?: string
  substituteTeacherName?: string  // denormalized
  checkInTime?: string
  checkOutTime?: string
  notes?: string
  createdAt: string
}

export interface Promotion {
  id: string
  name: string
  type: PromotionType
  value: number
  conditions?: string
  validFrom?: string
  validTo?: string
  isActive: boolean
  createdAt: string
}

export interface StudentPromotion {
  id: string
  studentId: string
  studentName: string             // denormalized
  classId: string
  className: string               // denormalized
  promotionId: string
  promotionName: string           // denormalized
  promotionType: PromotionType    // denormalized
  promotionValue: number          // denormalized
  appliedFrom: string
  appliedTo?: string
  approvedById?: string
  notes?: string
  createdAt: string
}

export interface TuitionRecord {
  id: string
  studentId: string
  studentName: string             // denormalized
  classId: string
  className: string               // denormalized
  billingMonth: number
  billingYear: number
  totalSessions: number
  chargedSessions: number
  baseAmount: number
  discountAmount: number
  finalAmount: number
  status: TuitionStatus
  dueDate?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface Payment {
  id: string
  tuitionRecordId: string
  studentId: string               // denormalized — để query thanh toán của học viên
  studentName: string             // denormalized
  classId: string                 // denormalized
  amount: number
  paymentDate: string
  method: PaymentMethod
  receivedById?: string
  receivedByName?: string         // denormalized
  notes?: string
  createdAt: string
}

export interface Holiday {
  id: string
  date: string
  name: string
  description?: string
  createdAt: string
}

export interface Notification {
  id: string
  title: string
  content: string
  type: 'GENERAL' | 'PAYMENT_DUE' | 'SCHEDULE_CHANGE' | 'EXAM_REMINDER'
  targetType: 'ALL' | 'CLASS' | 'STUDENT'
  targetId?: string
  sendViaZalo: boolean
  sentAt?: string
  createdById?: string
  createdAt: string
}

export interface Lead {
  id: string
  zaloUserId: string
  parentName?: string
  studentName?: string
  gradeLevel?: string
  phone?: string
  status: 'NEW' | 'COLLECTING' | 'COMPLETED' | 'CONTACTED' | 'ENROLLED' | 'LOST'
  /** Bước hiện tại trong chatbot: 0=chào, 1=hỏi tên PH, 2=hỏi tên con+lớp, 3=hỏi SĐT, 4=hoàn tất */
  chatStep: number
  note?: string
  source?: string
  createdAt: string
  updatedAt: string
}


export type MaterialType = "LINK" | "FILE"
export type MaterialAudience = "STUDENT" | "CLASS"

export interface Material {
  id: string
  title: string
  description?: string
  type: MaterialType
  // Khi type=LINK
  url?: string
  // Khi type=FILE
  storagePath?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
  // Phạm vi
  audienceType: MaterialAudience
  audienceIds: string[]
  // Người upload
  uploaderId: string
  uploaderName: string
  createdAt: string
  updatedAt: string
}
