import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-fg">
      <div className="text-center">
        <h1 className="text-4xl font-semibold">404</h1>
        <p className="mt-2 text-sm text-fg/50">Page not found</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
