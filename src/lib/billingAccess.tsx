import React, { createContext, useContext } from "react";
import { useToast } from "@/lib/toast";

export type BillingAccess = {
  readOnly: boolean;
  hasFullAccess: boolean;
  canUsePremiumFeatures: boolean;
  isFounder: boolean;
  isPastDue: boolean;
  statusMessage: string;
};

const defaultBillingAccess: BillingAccess = {
  readOnly: false,
  hasFullAccess: true,
  canUsePremiumFeatures: true,
  isFounder: false,
  isPastDue: false,
  statusMessage: "",
};

const BillingAccessContext = createContext<BillingAccess>(defaultBillingAccess);

export function BillingAccessProvider({
  value,
  children,
}: {
  value: BillingAccess;
  children: React.ReactNode;
}) {
  return (
    <BillingAccessContext.Provider value={value}>
      {children}
    </BillingAccessContext.Provider>
  );
}

export function useBillingAccess() {
  return useContext(BillingAccessContext);
}

export function useBillingWriteGuard() {
  const billing = useBillingAccess();

  return (action = "make changes") => {
    if (!billing.readOnly) return true;

    useToast.getState().add(
      `Your account is in read-only mode. Upgrade to ${action}.`,
      "warning"
    );
    return false;
  };
}