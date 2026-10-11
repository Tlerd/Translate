'use client';

import React, { createContext, useContext } from 'react';

interface AccountContextValue {
  accountControls?: React.ReactNode;
  /** Signed-in email; absent on an unconfigured local development server. */
  accountEmail?: string | null;
}

const AccountContext = createContext<AccountContextValue>({});

export function AccountProvider({
  children,
  accountControls,
  accountEmail = null,
}: {
  children: React.ReactNode;
  accountControls?: React.ReactNode;
  accountEmail?: string | null;
}) {
  return (
    <AccountContext.Provider value={{ accountControls, accountEmail }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
