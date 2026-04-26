import React, { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { User } from '../types'

interface Props {
  roles: User['role'][]
  children: ReactNode
  fallback?: string
}

export default function RequireRole({ roles, children, fallback = '/dashboard' }: Props) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={fallback} replace />
  return <>{children}</>
}
