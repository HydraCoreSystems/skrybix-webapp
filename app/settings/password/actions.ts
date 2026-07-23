"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { getPasswordHash, setPasswordHash } from "@/lib/site-auth-db";

export async function changePassword(formData: FormData) {
  const current = String(formData.get("current_password") || "");
  const next = String(formData.get("new_password") || "");
  const confirm = String(formData.get("confirm_password") || "");

  if (next.length < 8) {
    redirect("/settings/password?error=" + encodeURIComponent("New password must be at least 8 characters."));
  }
  if (next !== confirm) {
    redirect("/settings/password?error=" + encodeURIComponent("New password and confirmation don't match."));
  }

  const hash = await getPasswordHash();
  if (!hash || !(await bcrypt.compare(current, hash))) {
    redirect("/settings/password?error=" + encodeURIComponent("Current password is incorrect."));
  }

  const newHash = await bcrypt.hash(next, 10);
  await setPasswordHash(newHash);

  redirect("/settings/password?success=" + encodeURIComponent("Password updated."));
}
