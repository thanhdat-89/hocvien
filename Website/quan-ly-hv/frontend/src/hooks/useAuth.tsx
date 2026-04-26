import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import api from '../services/api'
import { User } from '../types'

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
  isStaff: boolean
  isTeacher: boolean
  canManageStudents: boolean // create+edit+delete students, manage enrollments, finance
  canManageClasses: boolean  // create+edit+delete classes
  canSeeFinance: boolean     // /tuition + revenue widgets
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })
  const [loading, setLoading] = useState(false)

  const login = async (username: string, password: string) => {
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { username, password })
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      setUser(data.user)
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const role = user?.role
  const isAdmin = role === 'ADMIN'
  const isStaff = role === 'STAFF'
  const isTeacher = role === 'TEACHER'
  const canManageStudents = isAdmin || isStaff
  const canManageClasses = isAdmin || isStaff
  const canSeeFinance = isAdmin || isStaff

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout,
      isAdmin, isStaff, isTeacher,
      canManageStudents, canManageClasses, canSeeFinance,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
