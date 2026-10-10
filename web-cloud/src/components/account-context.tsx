'use client';

import React, { createContext, useContext } from 'react';

interface AccountContextValue {
  accountControls?: React.ReactNode;
}

const AccountContext = createContext<AccountContextValue>({});

export function AccountProvider({
  children,
  accountControls,
}: {
  children: React.ReactNode;
  accountControls?: React.ReactNode;
}) {
  return (
    <AccountContext.Provider value={{ accountControls }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
