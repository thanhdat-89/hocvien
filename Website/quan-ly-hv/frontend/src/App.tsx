import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import Layout from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import StudentProfile from './pages/StudentProfile'
import Classes from './pages/Classes'
import Tuition from './pages/Tuition'
import Attendance from './pages/Attendance'
import Notifications from './pages/Notifications'
import Leads from './pages/Leads'
import PrivateSchedule from './pages/PrivateSchedule'
import Tests from './pages/Tests'
import Reviews from './pages/Reviews'
import Materials from './pages/Materials'
import Teachers from './pages/Teachers'
import Activity from './pages/Activity'
import Zns from './pages/Zns'
import RequireRole from './components/RequireRole'

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/students" element={<Students />} />
            <Route path="/students/:id" element={<StudentProfile />} />
            <Route path="/classes" element={<Classes />} />
            <Route path="/private-schedule" element={<PrivateSchedule />} />
            <Route path="/exams" element={<Tests />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/materials" element={<Materials />} />
            <Route path="/teachers" element={<RequireRole roles={['ADMIN']}><Teachers /></RequireRole>} />
            <Route path="/tuition" element={<RequireRole roles={['ADMIN', 'STAFF']}><Tuition /></RequireRole>} />
            <Route path="/attendance" element={<RequireRole roles={['ADMIN', 'STAFF']}><Attendance /></RequireRole>} />
            <Route path="/notifications" element={<RequireRole roles={['ADMIN', 'STAFF']}><Notifications /></RequireRole>} />
            <Route path="/leads" element={<RequireRole roles={['ADMIN', 'STAFF']}><Leads /></RequireRole>} />
            <Route path="/activity" element={<RequireRole roles={['ADMIN', 'STAFF']}><Activity /></RequireRole>} />
            <Route path="/zns" element={<RequireRole roles={['ADMIN']}><Zns /></RequireRole>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
