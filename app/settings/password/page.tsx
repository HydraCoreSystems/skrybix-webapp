import { changePassword } from "./actions";

export const dynamic = "force-dynamic";

export default function ChangePasswordPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string };
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Update Site Password</h3>
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
          <button className="btn" type="submit">
            Update Password
          </button>
        </p>
      </form>
    </div>
  );
}
