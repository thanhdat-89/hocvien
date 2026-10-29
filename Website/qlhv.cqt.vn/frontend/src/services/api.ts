/// <reference types="vite/client" />
import axios from 'axios'
import { queryClient } from './queryClient'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api',
})

/** Cơ sở / năm học đang xem (hooks/useWorkspace); trống = mặc định của server */
export const BRANCH_KEY = 'qlhv.branch'
export const SCHOOL_YEAR_KEY = 'qlhv.schoolYear'
const BRANCH_DENIED = 'Không có quyền với cơ sở này'

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Danh sách để chọn cơ sở / năm học không phụ thuộc lựa chọn hiện tại (lựa chọn có thể đã hết hiệu lực)
  if (!/^\/(branches|school-years|auth)(\/|\?|$)/.test(config.url || '')) {
    const branch = localStorage.getItem(BRANCH_KEY), year = localStorage.getItem(SCHOOL_YEAR_KEY)
    if (branch) config.headers['X-Branch-Id'] = branch
    if (year) config.headers['X-School-Year-Id'] = year
  }
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
    // Bị gỡ phân công cơ sở đang chọn: về mặc định
    if (err.response?.status === 403 && err.response.data?.message === BRANCH_DENIED && localStorage.getItem(BRANCH_KEY)) {
      localStorage.removeItem(BRANCH_KEY)
      window.location.reload()
    }
    return Promise.reject(err)
  }
)

export default api
