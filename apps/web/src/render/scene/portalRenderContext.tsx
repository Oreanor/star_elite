import { createContext, useContext, type ReactNode } from 'react'

export type PortalRenderSide = 'source' | 'destination'

const PortalRenderContext = createContext<PortalRenderSide>('source')

export function PortalRenderScope({ side, children }: { side: PortalRenderSide; children: ReactNode }) {
  return <PortalRenderContext.Provider value={side}>{children}</PortalRenderContext.Provider>
}

export function usePortalRenderSide(): PortalRenderSide {
  return useContext(PortalRenderContext)
}
