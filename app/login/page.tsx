import { login } from "./actions";

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div className="card" style={{ maxWidth: 360, margin: "80px auto" }}>
      <h3 style={{ marginTop: 0 }}>Skrybix</h3>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>Enter the site password to continue.</p>
      {searchParams.error && <div className="flash error">{searchParams.error}</div>}
      <form action={login}>
        <label>Password</label>
        <input type="password" name="password" required autoFocus />
        <p>
          <button className="btn" type="submit">
            Log in
          </button>
        </p>
      </form>
    </div>
  );
}
