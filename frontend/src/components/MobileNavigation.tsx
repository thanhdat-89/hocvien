import { createContext, useContext } from 'react'

export const MobileNavigationContext = createContext({
  open: false,
  toggle: () => {},
})

export const useMobileNavigation = () => useContext(MobileNavigationContext)
