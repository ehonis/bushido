/*
 * "Something in this sheet was changed" (#77), told to the sheet by the inputs
 * inside it. `Modal` (Sheet.tsx) provides it and turns swipe-down off from the
 * first real change; kit's `Input` (so every NumInput) calls it on every edit.
 * Focusing a box is not a change. Its own file so kit and Sheet do not import
 * each other.
 */
import { createContext, useContext } from 'react'

export const SheetDirty = createContext<(() => void) | null>(null)
export const useMarkDirty = () => useContext(SheetDirty)
