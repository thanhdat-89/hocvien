import { useLayoutEffect, useRef, useState } from 'react'

/** Reserve space using the full sidebar baseline, so collapsing cannot trigger expansion. */
export function useCompactSidebar(pathname: string) {
  const contentRef = useRef<HTMLElement>(null)
  const [compact, setCompact] = useState(false)
  const compactRef = useRef(false)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    let frame = 0
    // Keep the route's measured requirement during loading/refresh placeholders.
    let requiredWidth = 760
    const measure = () => {
      frame = 0
      const width = document.documentElement.clientWidth
      if (width < 1024) {
        compactRef.current = false
        setCompact(false)
        return
      }
      for (const table of content.querySelectorAll('table')) {
        if (!table.getClientRects().length) continue
        const minWidth = getComputedStyle(table).minWidth
        const minimum = minWidth.endsWith('px') ? Number.parseFloat(minWidth) : 0
        // Auto-sized tables (e.g. activity/invoices) may overflow without an
        // explicit min-width. Remember that requirement once observed.
        const container = table.parentElement
        const overflowingWidth = !minimum && container && table.scrollWidth > container.clientWidth + 1 ? table.scrollWidth : 0
        const page = table.closest('.page-content')
        const style = page ? getComputedStyle(page) : null
        const padding = style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 64
        requiredWidth = Math.max(requiredWidth, Math.max(minimum, overflowingWidth) + padding + 2)
      }
      const availableWithFullMenu = width - 256
      const next = availableWithFullMenu < requiredWidth + (compactRef.current ? 48 : 0)
      if (next !== compactRef.current) {
        compactRef.current = next
        setCompact(next)
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    const resize = new ResizeObserver(schedule)
    resize.observe(document.documentElement)
    resize.observe(content)
    const mutations = new MutationObserver(schedule)
    mutations.observe(content, { childList: true, subtree: true })
    return () => { resize.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame) }
  }, [pathname])

  return { compact, contentRef }
}
