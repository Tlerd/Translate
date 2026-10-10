'use client';

import React, { createContext, useContext } from 'react';

export interface SidebarContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/** Provided by AppShell so pages (e.g. the recording detail header) can drive the sidebar. */
export function SidebarProvider({ value, children }: { value: SidebarContextValue; children: React.ReactNode }) {
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

const detachedSidebar: SidebarContextValue = {
  sidebarOpen: false,
  setSidebarOpen: () => {},
  toggleSidebar: () => {},
};

/** Returns the shell's sidebar state. Outside an AppShell it is an inert fallback. */
export function useSidebarToggle(): SidebarContextValue {
  return useContext(SidebarContext) ?? detachedSidebar;
}
