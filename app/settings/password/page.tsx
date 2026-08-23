import { changePassword } from "./actions";
import ThemePicker from "@/components/ThemePicker";

export const dynamic = "force-dynamic";

export default function ChangePasswordPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string };
}) {
  return (
    <>
      <ThemePicker />
      <div className="card record-form-page compact-form-page">
        <p className="eyebrow">Owner access</p><h1>Update Site Password</h1>
        {searchParams.success && <div className="flash success">{searchParams.success}</div>}
        {searchParams.error && <div className="flash error">{searchParams.error}</div>}
        <form action={changePassword}>
          <label>Current password</label>
          <input type="password" name="current_password" required />

          <label>New password</label>
          <input type="password" name="new_password" required minLength={8} />

          <label>Confirm new password</label>
          <input type="password" name="confirm_password" required minLength={8} />

          <p>
            <button className="btn warm" type="submit">
              Update Password
            </button>
          </p>
        </form>
      </div>
    </>
  );
}
