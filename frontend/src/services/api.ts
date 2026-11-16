/// <reference types="vite/client" />
import axios from 'axios'
import { queryClient } from './queryClient'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api',
})

/** Năm học đang xem (hooks/useWorkspace); trống = năm đang chạy. Cơ sở làm việc lưu ở tài khoản (Cài đặt). */
export const SCHOOL_YEAR_KEY = 'qlhv.schoolYear'

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  const year = localStorage.getItem(SCHOOL_YEAR_KEY)
  if (year) config.headers['X-School-Year-Id'] = year
  return config
})

api.interceptors.response.use(
  (res) => {
    const mutation = ['post', 'put', 'patch', 'delete'].includes(res.config.method || '')
    const path = res.config.url || ''
    if (mutation && /^\/(students|classes|tuition|schedules|sessions|holidays|parents)(\/|\?|$)/.test(path)
      && !/^\/tuition\/misa(\/|$)/.test(path)) {
      // Mark inactive pages stale without adding requests to the user's write flow.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: ['students'], refetchType: 'none' })
    }
    return res
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
