export default function ComingSoon() {
  return (
    <main className="landing-root flex min-h-dvh items-center justify-center px-6 py-12 text-slate-100">
      <section className="w-full max-w-xl border border-white/15 bg-slate-950/70 p-8 text-center shadow-2xl backdrop-blur sm:p-12">
        <img src="/FramersApp%20Logo%20white.png" alt="Framers App" className="mx-auto h-10 w-auto object-contain" />
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Launching soon</p>
        <h1 className="mt-3 text-4xl font-black text-white sm:text-5xl">Framers App</h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-7 text-slate-200">
          Business management for independent framing studios. We are preparing the full experience for launch.
        </p>
      </section>
    </main>
  );
}