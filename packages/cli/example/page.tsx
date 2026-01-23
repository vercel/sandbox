export default function Home() {
  return (
    <div>
    <div className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="space-y-6 pb-8 pt-10 md:pb-12 md:pt-20 lg:py-32">
        <div className="flex max-w-[64rem] flex-col items-center gap-4 text-center">
          <div className="rounded-full bg-muted px-4 py-1.5 text-sm font-medium">Introducing Vercel Sandbox</div>
          <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
            Run arbitrary code anywhere
          </h1>
          <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
            Vercel Sandbox is a serverless compute platform that lets you run arbitrary code globally.
          </p>
        </div>
      </section>
    </div>
    </div>
  )
}
