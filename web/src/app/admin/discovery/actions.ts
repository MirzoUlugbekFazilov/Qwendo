"use server";

import { revalidatePath } from "next/cache";
import { ApiError, request } from "@/lib/api";
import { adminToken } from "./access";

export async function saveDiscovery(kind: "sources" | "keywords" | "submissions", _: string, form: FormData) {
  const token = await adminToken();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const slug = field("slug");
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(slug)) return "Enter a valid identifier.";
  let body;
  try {
    if (kind === "sources") body = {
      kind: field("kind"), enabled: form.has("enabled"), url: field("url"),
      permission: field("permission"), allowed_hosts: field("allowed_hosts").split(/[\s,]+/).filter(Boolean),
      config: JSON.parse(field("config") || "{}"), interval_minutes: Number(field("interval_minutes")),
    };
    else if (kind === "keywords") body = JSON.parse(field("entry"));
    else if (kind === "submissions") body = {
      decision: field("decision"), source_slug: field("decision") === "queue" ? field("source_slug") || null : null,
    };
    else return "Unknown action.";
  } catch {
    return "Enter valid JSON.";
  }
  const review = kind === "submissions";
  try {
    await request(`/v1/admin/discovery/${kind}/${slug}${review ? "/review" : ""}`, {
      token, method: review ? "POST" : "PUT", body,
    });
  } catch (error) {
    return error instanceof ApiError ? error.message : "Couldn’t save changes. Try again.";
  }
  revalidatePath("/admin/discovery");
  return "Saved.";
}
