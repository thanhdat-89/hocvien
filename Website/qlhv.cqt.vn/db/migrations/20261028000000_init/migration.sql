-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TEACHER', 'STAFF');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TeacherStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'DROPPED', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'MAKEUP');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "TeacherAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'SUBSTITUTE');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SESSIONS');

-- CreateEnum
CREATE TYPE "TuitionStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOMO', 'OTHER');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "dateOfBirth" DATE,
    "idCard" TEXT,
    "bankAccount" TEXT,
    "bankName" TEXT,
    "salaryRatePerSession" INTEGER NOT NULL DEFAULT 0,
    "status" "TeacherStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "school" TEXT,
    "gradeLevel" INTEGER,
    "address" TEXT,
    "enrollmentDate" DATE NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "avatarUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parents" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" "Relationship",
    "phone" TEXT,
    "zalo" TEXT,
    "email" TEXT,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_reviews" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "teacherId" TEXT,
    "month" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gradeLevel" INTEGER,
    "tuitionRatePerSession" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectId" TEXT,
    "teacherId" TEXT,
    "room" TEXT,
    "maxStudents" INTEGER,
    "tuitionRate" INTEGER,
    "sessionsPerMonth" INTEGER,
    "gradeLevel" INTEGER,
    "startDate" DATE,
    "endDate" DATE,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "activeStudentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_tuition_rates" (
    "classId" TEXT NOT NULL,
    "effectiveMonth" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,

    CONSTRAINT "class_tuition_rates_pkey" PRIMARY KEY ("classId","effectiveMonth")
);

-- CreateTable
CREATE TABLE "class_enrollments" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrollmentDate" DATE NOT NULL,
    "dropDate" DATE,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "customTuitionRate" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT,
    "scheduleId" TEXT,
    "sessionDate" DATE NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_sessions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "teacherName" TEXT,
    "ratePerSession" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "private_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "dates" DATE[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_attendances" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_attendances" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "status" "TeacherAttendanceStatus" NOT NULL,
    "substituteTeacherId" TEXT,
    "checkInTime" VARCHAR(5),
    "checkOutTime" VARCHAR(5),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "value" INTEGER NOT NULL,
    "conditions" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_promotions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT,
    "promotionId" TEXT NOT NULL,
    "promotionName" TEXT NOT NULL,
    "promotionType" "PromotionType" NOT NULL,
    "promotionValue" INTEGER NOT NULL,
    "appliedFrom" DATE NOT NULL,
    "appliedTo" DATE,
    "approvedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tuition_records" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT,
    "billingMonth" INTEGER NOT NULL,
    "billingYear" INTEGER NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "chargedSessions" INTEGER NOT NULL,
    "baseAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "finalAmount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" INTEGER NOT NULL,
    "status" "TuitionStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tuition_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tuitionRecordId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentDate" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "receivedById" TEXT,
    "receivedByName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "sepayId" BIGINT NOT NULL,
    "gateway" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "transferType" VARCHAR(3) NOT NULL,
    "transferAmount" INTEGER NOT NULL,
    "accumulated" BIGINT NOT NULL,
    "content" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(0) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "matchedStudentId" TEXT,
    "matchedTuitionRecordId" TEXT,
    "matchedPaymentId" TEXT,
    "matchReason" TEXT,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_scores" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT,
    "className" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "scores" JSONB NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 10,
    "notes" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "monthly_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" VARCHAR(4) NOT NULL,
    "url" TEXT,
    "cloudinaryPublicId" TEXT,
    "cloudinaryResourceType" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "audienceType" VARCHAR(7) NOT NULL,
    "audienceIds" TEXT[],
    "uploaderId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "misa_invoices" (
    "id" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "invoiceDate" DATE NOT NULL,
    "invoiceNumber" TEXT,
    "invoiceCode" TEXT,
    "transactionId" TEXT,
    "lastErrorMessage" TEXT,
    "recordIds" TEXT[],
    "billingPeriods" TEXT[],
    "source" JSONB NOT NULL,
    "sources" JSONB,
    "template" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "restoredAt" TIMESTAMPTZ(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "misa_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "misa_invoice_replacements" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "replacedAt" TIMESTAMPTZ(3) NOT NULL,
    "originalInvoice" JSONB NOT NULL,
    "originalFee" JSONB,

    CONSTRAINT "misa_invoice_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_drafts" (
    "id" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "invoiceDate" DATE NOT NULL,
    "source" JSONB NOT NULL,
    "template" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "provider" TEXT,
    "syncAttempts" INTEGER,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_outbox" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "tuitionRecordId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "nextRetryAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_invoice_runs" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "cutoff" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" BIGINT,
    "total" INTEGER,
    "excludedAfterCutoff" INTEGER,
    "startedAt" TIMESTAMPTZ(3),
    "reconciledAt" TIMESTAMPTZ(3),
    "extra" JSONB,

    CONSTRAINT "monthly_invoice_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_invoice_run_items" (
    "runId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "linkedInvoiceId" TEXT NOT NULL,

    CONSTRAINT "monthly_invoice_run_items_pkey" PRIMARY KEY ("runId","id")
);

-- CreateTable
CREATE TABLE "zns_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "useCase" VARCHAR(4) NOT NULL,
    "paramKeys" TEXT[],
    "cost" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "zns_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zns_logs" (
    "id" TEXT NOT NULL,
    "studentId" TEXT,
    "parentPhone" TEXT NOT NULL,
    "parentPhoneIntl" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "useCase" VARCHAR(4) NOT NULL,
    "invoiceId" TEXT,
    "reminderCount" INTEGER,
    "params" JSONB NOT NULL,
    "trackingId" TEXT,
    "status" TEXT NOT NULL,
    "msgId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),

    CONSTRAINT "zns_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_alerts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "sendViaZalo" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "source" TEXT,
    "zaloUserId" TEXT,
    "collaboratorId" TEXT,
    "parentName" TEXT,
    "parentPhone" TEXT,
    "studentName" TEXT,
    "gradeLevel" TEXT,
    "status" TEXT NOT NULL,
    "chatStep" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "description" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "ip" TEXT NOT NULL,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_integrity_audits" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "checkedClasses" INTEGER NOT NULL,
    "checkedRows" INTEGER NOT NULL,
    "anomalies" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_integrity_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_userId_key" ON "teachers"("userId");

-- CreateIndex
CREATE INDEX "students_status_gradeLevel_idx" ON "students"("status", "gradeLevel");

-- CreateIndex
CREATE INDEX "students_fullName_idx" ON "students"("fullName");

-- CreateIndex
CREATE INDEX "parents_studentId_idx" ON "parents"("studentId");

-- CreateIndex
CREATE INDEX "parents_phone_idx" ON "parents"("phone");

-- CreateIndex
CREATE INDEX "student_reviews_studentId_month_idx" ON "student_reviews"("studentId", "month");

-- CreateIndex
CREATE INDEX "classes_status_idx" ON "classes"("status");

-- CreateIndex
CREATE INDEX "class_enrollments_classId_status_idx" ON "class_enrollments"("classId", "status");

-- CreateIndex
CREATE INDEX "class_enrollments_studentId_status_idx" ON "class_enrollments"("studentId", "status");

-- CreateIndex
CREATE INDEX "schedules_classId_idx" ON "schedules"("classId");

-- CreateIndex
CREATE INDEX "sessions_sessionDate_idx" ON "sessions"("sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_classId_sessionDate_startTime_key" ON "sessions"("classId", "sessionDate", "startTime");

-- CreateIndex
CREATE INDEX "private_sessions_studentId_sessionDate_idx" ON "private_sessions"("studentId", "sessionDate");

-- CreateIndex
CREATE INDEX "private_sessions_sessionDate_idx" ON "private_sessions"("sessionDate");

-- CreateIndex
CREATE INDEX "student_attendances_studentId_idx" ON "student_attendances"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "student_attendances_sessionId_studentId_key" ON "student_attendances"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "teacher_attendances_teacherId_idx" ON "teacher_attendances"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendances_sessionId_teacherId_key" ON "teacher_attendances"("sessionId", "teacherId");

-- CreateIndex
CREATE INDEX "student_promotions_studentId_idx" ON "student_promotions"("studentId");

-- CreateIndex
CREATE INDEX "tuition_records_billingYear_billingMonth_status_idx" ON "tuition_records"("billingYear", "billingMonth", "status");

-- CreateIndex
CREATE INDEX "tuition_records_studentId_idx" ON "tuition_records"("studentId");

-- CreateIndex
CREATE INDEX "payments_tuitionRecordId_idx" ON "payments"("tuitionRecordId");

-- CreateIndex
CREATE INDEX "payments_studentId_idx" ON "payments"("studentId");

-- CreateIndex
CREATE INDEX "payments_paymentDate_idx" ON "payments"("paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_sepayId_key" ON "bank_transactions"("sepayId");

-- CreateIndex
CREATE INDEX "bank_transactions_status_idx" ON "bank_transactions"("status");

-- CreateIndex
CREATE INDEX "monthly_scores_year_month_idx" ON "monthly_scores"("year", "month");

-- CreateIndex
CREATE INDEX "materials_audienceIds_idx" ON "materials" USING GIN ("audienceIds");

-- CreateIndex
CREATE INDEX "misa_invoices_refId_idx" ON "misa_invoices"("refId");

-- CreateIndex
CREATE INDEX "misa_invoices_recordIds_idx" ON "misa_invoices" USING GIN ("recordIds");

-- CreateIndex
CREATE INDEX "misa_invoice_replacements_recordId_idx" ON "misa_invoice_replacements"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_outbox_idempotencyKey_key" ON "invoice_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "invoice_outbox_status_nextRetryAt_idx" ON "invoice_outbox"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "monthly_invoice_run_items_runId_status_idx" ON "monthly_invoice_run_items"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "zns_logs_trackingId_key" ON "zns_logs"("trackingId");

-- CreateIndex
CREATE INDEX "zns_logs_invoiceId_idx" ON "zns_logs"("invoiceId");

-- CreateIndex
CREATE INDEX "zns_logs_studentId_idx" ON "zns_logs"("studentId");

-- CreateIndex
CREATE INDEX "admin_alerts_read_createdAt_idx" ON "admin_alerts"("read", "createdAt");

-- CreateIndex
CREATE INDEX "leads_zaloUserId_idx" ON "leads"("zaloUserId");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_resourceType_resourceId_idx" ON "activity_logs"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parents" ADD CONSTRAINT "parents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_reviews" ADD CONSTRAINT "student_reviews_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_reviews" ADD CONSTRAINT "student_reviews_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_tuition_rates" ADD CONSTRAINT "class_tuition_rates_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_sessions" ADD CONSTRAINT "private_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendances" ADD CONSTRAINT "student_attendances_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendances" ADD CONSTRAINT "student_attendances_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendances" ADD CONSTRAINT "student_attendances_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendances" ADD CONSTRAINT "teacher_attendances_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuition_records" ADD CONSTRAINT "tuition_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuition_records" ADD CONSTRAINT "tuition_records_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tuitionRecordId_fkey" FOREIGN KEY ("tuitionRecordId") REFERENCES "tuition_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_scores" ADD CONSTRAINT "monthly_scores_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_invoice_run_items" ADD CONSTRAINT "monthly_invoice_run_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "monthly_invoice_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── constraints.sql ───
-- Ràng buộc Prisma không diễn đạt được. Chạy sau `prisma migrate` (đưa vào một migration SQL).
-- Thay cho các bảo đảm mà Firestore trước đây làm bằng ID cố định / transaction trong code.

-- Mỗi học viên chỉ có một ghi danh ACTIVE trong một lớp (cho phép DROPPED rồi ghi danh lại).
CREATE UNIQUE INDEX class_enrollments_active_uniq
  ON class_enrollments ("studentId", "classId")
  WHERE status = 'ACTIVE';

-- Một phiếu học phí cho mỗi học viên × lớp (hoặc học riêng) × tháng.
CREATE UNIQUE INDEX tuition_records_period_uniq
  ON tuition_records ("studentId", COALESCE("classId", 'private'), "billingYear", "billingMonth");

-- Một bảng điểm cho mỗi học viên × lớp (hoặc học riêng) × tháng.
CREATE UNIQUE INDEX monthly_scores_period_uniq
  ON monthly_scores ("studentId", COALESCE("classId", 'private'), year, month);

ALTER TABLE tuition_records
  ADD CONSTRAINT tuition_records_month_chk  CHECK ("billingMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT tuition_records_amount_chk CHECK ("baseAmount" >= 0 AND "discountAmount" >= 0 AND "finalAmount" >= 0 AND "paidAmount" >= 0);

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_chk CHECK (amount > 0);

ALTER TABLE monthly_scores
  ADD CONSTRAINT monthly_scores_month_chk CHECK (month BETWEEN 1 AND 12);

ALTER TABLE private_sessions
  ADD CONSTRAINT private_sessions_rate_chk CHECK ("ratePerSession" >= 0);

ALTER TABLE sessions
  ADD CONSTRAINT sessions_time_chk CHECK ("startTime" ~ '^\d{2}:\d{2}$' AND "endTime" ~ '^\d{2}:\d{2}$');
