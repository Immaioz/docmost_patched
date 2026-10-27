import { useAtom } from "jotai";
import { entitlementAtom } from "@/ee/entitlement/entitlement-atom";

export const useHasFeature = (feature: string): boolean => {
  const [entitlements] = useAtom(entitlementAtom);
  if (entitlements?.features?.includes(feature)) return true;
  // Fallback for self-hosted: enable all EE features by default
  return true;
};
