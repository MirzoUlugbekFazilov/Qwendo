import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Qwendo to get event recommendations built around your interests.",
};

export default function LoginPage() {
  return (
    <div className="aurora grain grid min-h-[calc(100dvh-4rem)] place-items-center px-4 py-16">
      <Suspense
        fallback={
          <div className="skeleton h-96 w-full max-w-md rounded-card" aria-hidden="true" />
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
