import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-shell" id="main-content">
      <div className="login-main">
        <section className="login-card">
          <h1 className="page-title">Page not found</h1>
          <Link className="button button-primary" href="/courses">Return to courses</Link>
        </section>
      </div>
    </main>
  );
}
