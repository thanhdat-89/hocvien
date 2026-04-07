/**
 * Script seed dữ liệu mẫu vào Firestore
 * Chạy: npx tsx src/scripts/seedFirebase.ts
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db, C } from '../lib/firebase'

async function seed() {
  console.log('🌱 Bắt đầu seed dữ liệu vào Firestore...')

  // ─── 1. Users ────────────────────────────────────────────
  const adminRef = db.collection(C.USERS).doc('admin')
  await adminRef.set({
    username: 'admin',
    passwordHash: await bcrypt.hash('admin123', 10),
    role: 'ADMIN',
    fullName: 'Quản trị viên',
    email: 'admin@trungtam.vn',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const teacherUserRef = db.collection(C.USERS).doc('user-gv-an')
  await teacherUserRef.set({
    username: 'gv.nguyenvan',
    passwordHash: await bcrypt.hash('teacher123', 10),
    role: 'TEACHER',
    fullName: 'Nguyễn Văn An',
    email: 'nguyenvanan@trungtam.vn',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  // ─── 2. Teachers ─────────────────────────────────────────
  const teacher1Ref = db.collection(C.TEACHERS).doc('teacher-an')
  await teacher1Ref.set({
    userId: 'user-gv-an',
    fullName: 'Nguyễn Văn An',
    phone: '0901234567',
    salaryRatePerSession: 200000,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const teacher2Ref = db.collection(C.TEACHERS).doc('teacher-binh')
  await teacher2Ref.set({
    fullName: 'Trần Thị Bình',
    phone: '0912345678',
    salaryRatePerSession: 180000,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  // ─── 3. Subjects ─────────────────────────────────────────
  const subjectRefs = [
    { id: 'sub-toan9',    data: { name: 'Toán lớp 9',       gradeLevel: 9,  tuitionRatePerSession: 80000,  isActive: true } },
    { id: 'sub-toan10',   data: { name: 'Toán lớp 10',      gradeLevel: 10, tuitionRatePerSession: 90000,  isActive: true } },
    { id: 'sub-toan12',   data: { name: 'Toán lớp 12',      gradeLevel: 12, tuitionRatePerSession: 100000, isActive: true } },
    { id: 'sub-toan12nc', data: { name: 'Toán nâng cao 12', gradeLevel: 12, tuitionRatePerSession: 120000, isActive: true } },
  ]
  for (const s of subjectRefs) {
    await db.collection(C.SUBJECTS).doc(s.id).set({ ...s.data, createdAt: new Date().toISOString() })
  }

  // ─── 4. Classes ──────────────────────────────────────────
  const class9ARef = db.collection(C.CLASSES).doc('class-9a')
  await class9ARef.set({
    name: 'Toán 9A - Tối T2/T4/T6',
    subjectId: 'sub-toan9', subjectName: 'Toán lớp 9',
    teacherId: 'teacher-an', teacherName: 'Nguyễn Văn An',
    gradeLevel: 9, room: 'P.101', maxStudents: 15,
    tuitionRate: 80000, sessionsPerMonth: 12,
    startDate: '2025-09-01', endDate: null,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })

  const class12NCRef = db.collection(C.CLASSES).doc('class-12nc')
  await class12NCRef.set({
    name: 'Toán NC 12 - Chiều T3/T5',
    subjectId: 'sub-toan12nc', subjectName: 'Toán nâng cao 12',
    teacherId: 'teacher-binh', teacherName: 'Trần Thị Bình',
    gradeLevel: 12, room: 'P.201', maxStudents: 12,
    tuitionRate: 120000, sessionsPerMonth: 8,
    startDate: '2025-09-01', endDate: null,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })

  // ─── 5. Schedules ────────────────────────────────────────
  const schedules = [
    { classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6', dayOfWeek: 'MONDAY',    startTime: '19:00', endTime: '21:00', effectiveFrom: '2025-09-01' },
    { classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6', dayOfWeek: 'WEDNESDAY', startTime: '19:00', endTime: '21:00', effectiveFrom: '2025-09-01' },
    { classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6', dayOfWeek: 'FRIDAY',    startTime: '19:00', endTime: '21:00', effectiveFrom: '2025-09-01' },
    { classId: 'class-12nc', className: 'Toán NC 12 - Chiều T3/T5', dayOfWeek: 'TUESDAY',  startTime: '15:00', endTime: '17:30', effectiveFrom: '2025-09-01' },
    { classId: 'class-12nc', className: 'Toán NC 12 - Chiều T3/T5', dayOfWeek: 'THURSDAY', startTime: '15:00', endTime: '17:30', effectiveFrom: '2025-09-01' },
  ]
  for (const s of schedules) {
    await db.collection(C.SCHEDULES).add({ ...s, createdAt: new Date().toISOString() })
  }

  // ─── 6. Students ─────────────────────────────────────────
  const student1Ref = db.collection(C.STUDENTS).doc('student-khoa')
  await student1Ref.set({
    fullName: 'Lê Minh Khoa',
    dateOfBirth: '2010-05-15',
    gender: 'MALE', school: 'THCS Nguyễn Du', gradeLevel: 9,
    address: '123 Lê Lợi, TP. HCM',
    enrollmentDate: '2025-09-01',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  await student1Ref.collection('parents').add({
    studentId: 'student-khoa', fullName: 'Lê Văn Dũng',
    relationship: 'FATHER', phone: '0931111111', zalo: '0931111111',
    isPrimaryContact: true, createdAt: new Date().toISOString(),
  })
  await student1Ref.collection('parents').add({
    studentId: 'student-khoa', fullName: 'Nguyễn Thị Hoa',
    relationship: 'MOTHER', phone: '0932222222', zalo: '0932222222',
    isPrimaryContact: false, createdAt: new Date().toISOString(),
  })

  const student2Ref = db.collection(C.STUDENTS).doc('student-lan')
  await student2Ref.set({
    fullName: 'Phạm Thị Lan',
    dateOfBirth: '2010-08-22',
    gender: 'FEMALE', school: 'THCS Trần Phú', gradeLevel: 9,
    address: '45 Nguyễn Huệ, TP. HCM',
    enrollmentDate: '2025-09-01',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  await student2Ref.collection('parents').add({
    studentId: 'student-lan', fullName: 'Phạm Văn Tài',
    relationship: 'FATHER', phone: '0943333333', zalo: '0943333333',
    isPrimaryContact: true, createdAt: new Date().toISOString(),
  })

  const student3Ref = db.collection(C.STUDENTS).doc('student-hung')
  await student3Ref.set({
    fullName: 'Trần Quốc Hùng',
    dateOfBirth: '2007-03-10',
    gender: 'MALE', school: 'THPT Gia Định', gradeLevel: 12,
    address: '78 Đinh Tiên Hoàng, TP. HCM',
    enrollmentDate: '2025-09-01',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  await student3Ref.collection('parents').add({
    studentId: 'student-hung', fullName: 'Trần Văn Mạnh',
    relationship: 'FATHER', phone: '0954444444', zalo: '0954444444',
    isPrimaryContact: true, createdAt: new Date().toISOString(),
  })

  // ─── 7. Enrollments ──────────────────────────────────────
  await db.collection(C.ENROLLMENTS).add({
    classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6',
    studentId: 'student-khoa', studentName: 'Lê Minh Khoa',
    enrollmentDate: '2025-09-01', status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  })
  await db.collection(C.ENROLLMENTS).add({
    classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6',
    studentId: 'student-lan', studentName: 'Phạm Thị Lan',
    enrollmentDate: '2025-09-01', status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  })
  await db.collection(C.ENROLLMENTS).add({
    classId: 'class-12nc', className: 'Toán NC 12 - Chiều T3/T5',
    studentId: 'student-hung', studentName: 'Trần Quốc Hùng',
    enrollmentDate: '2025-09-01', status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  })

  // ─── 8. Promotions ───────────────────────────────────────
  await db.collection(C.PROMOTIONS).doc('promo-sibling').set({
    name: 'Giảm giá anh chị em', type: 'PERCENTAGE', value: 10,
    conditions: 'Áp dụng khi có anh/chị/em cùng học tại trung tâm',
    isActive: true, createdAt: new Date().toISOString(),
  })

  // ─── 9. Sessions mẫu (tháng 3/2026) ─────────────────────
  const sessionDates = ['2026-03-02', '2026-03-04', '2026-03-06', '2026-03-09', '2026-03-11', '2026-03-13']
  const sessionIds: string[] = []
  for (const date of sessionDates) {
    const ref = await db.collection(C.SESSIONS).add({
      classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6',
      teacherId: 'teacher-an', teacherName: 'Nguyễn Văn An',
      sessionDate: date, startTime: '19:00', endTime: '21:00',
      status: date <= '2026-03-09' ? 'COMPLETED' : 'SCHEDULED',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    sessionIds.push(ref.id)
  }

  // ─── 10. Attendance mẫu ──────────────────────────────────
  const completedSessions = sessionDates.slice(0, 4) // 4 buổi đã hoàn thành
  for (let i = 0; i < completedSessions.length; i++) {
    const sessionDate = completedSessions[i]
    const sessionId = sessionIds[i]
    // Điểm danh HV
    for (const [sid, sname] of [['student-khoa', 'Lê Minh Khoa'], ['student-lan', 'Phạm Thị Lan']]) {
      await db.collection(C.STUDENT_ATTENDANCES).add({
        sessionId, sessionDate, classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6',
        studentId: sid, studentName: sname, status: 'PRESENT',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
    }
    // Chấm công GV
    await db.collection(C.TEACHER_ATTENDANCES).add({
      sessionId, sessionDate, classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6',
      teacherId: 'teacher-an', teacherName: 'Nguyễn Văn An', status: 'PRESENT',
      createdAt: new Date().toISOString(),
    })
  }

  // ─── 11. Tuition Record mẫu ──────────────────────────────
  const tuitionRef = await db.collection(C.TUITION_RECORDS).add({
    studentId: 'student-khoa', studentName: 'Lê Minh Khoa',
    classId: 'class-9a', className: 'Toán 9A - Tối T2/T4/T6',
    billingMonth: 3, billingYear: 2026,
    totalSessions: 13, chargedSessions: 13,
    baseAmount: 13 * 80000, discountAmount: 0, finalAmount: 13 * 80000,
    status: 'PENDING', dueDate: '2026-03-25',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })

  // Ghi nhận một khoản thanh toán mẫu
  await db.collection(C.PAYMENTS).add({
    tuitionRecordId: tuitionRef.id,
    studentId: 'student-khoa', studentName: 'Lê Minh Khoa',
    classId: 'class-9a',
    amount: 500000, paymentDate: '2026-03-15',
    method: 'CASH', receivedById: 'admin', receivedByName: 'Quản trị viên',
    createdAt: new Date().toISOString(),
  })

  console.log('✅ Seed hoàn tất!')
  console.log('   👤 Admin: admin / admin123')
  console.log('   👤 Giáo viên: gv.nguyenvan / teacher123')
  console.log('   📚 4 môn học, 2 lớp học')
  console.log('   👩‍🎓 3 học viên')
  console.log('   📅 6 buổi học tháng 3/2026')
}

seed()
  .catch(e => { console.error('❌ Lỗi seed:', e); process.exit(1) })
  .finally(() => process.exit(0))
