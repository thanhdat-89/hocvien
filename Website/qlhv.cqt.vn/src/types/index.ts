import { Request } from 'express'

export interface AuthPayload {
  userId: string
  role: 'ADMIN' | 'TEACHER' | 'STAFF'
}

export interface AuthRequest extends Request {
  user?: AuthPayload
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}
