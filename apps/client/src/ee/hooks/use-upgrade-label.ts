import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { entitlementAtom } from "@/ee/entitlement/entitlement-atom";
import { isCloud } from "@/lib/config";

export function useUpgradeLabel(): string {
  const { t } = useTranslation();
  return "";
}
