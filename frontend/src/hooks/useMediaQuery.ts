import { useEffect, useState } from 'react'

/** Theo dõi một media query; dùng để chỉ tải dữ liệu cho phần giao diện đang hiển thị. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Điện thoại: dưới breakpoint md của Tailwind (768px). */
export const useIsPhone = () => useMediaQuery('(max-width: 767px)')
