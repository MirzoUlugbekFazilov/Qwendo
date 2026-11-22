import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding-form";
import { getAccessToken } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your discovery profile" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!(await getAccessToken())) redirect("/login?next=/onboarding");
  return <OnboardingForm />;
}
