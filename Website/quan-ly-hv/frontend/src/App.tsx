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
            <Route path="/tuition" element={<Tuition />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/leads" element={<Leads />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
