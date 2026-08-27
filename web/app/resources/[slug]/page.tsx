import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'
import { MDXRemote } from 'next-mdx-remote/rsc'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { ArrowLeft, Clock, ArrowRight } from 'lucide-react'
import { getAllGuides, getGuide } from '@/lib/guides'

export function generateStaticParams() {
  return getAllGuides().map(g => ({ slug: g.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const guide = getGuide(slug)
  if (!guide) return { title: 'Guide not found — BidWise' }
  const url = `${SITE_URL}/resources/${slug}`
  return {
    title: `${guide.meta.title} — BidWise Resources`,
    description: guide.meta.description,
    alternates: { canonical: url },
    openGraph: {
      title: guide.meta.title,
      description: guide.meta.description,
      url,
      type: 'article',
    },
  }
}

// Dark-theme styling for rendered markdown. Keeps article typography consistent
// with the rest of the site without pulling in the Tailwind typography plugin.
const mdxComponents = {
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-2xl font-black text-white mt-12 mb-4 tracking-tight" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-lg font-bold text-white mt-8 mb-3" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-slate-300 leading-relaxed mb-5" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc pl-5 space-y-2 mb-5 text-slate-300 marker:text-[#10A7FF]" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal pl-5 space-y-2 mb-5 text-slate-300 marker:text-slate-500" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed pl-1" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-bold text-white" {...props} />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-[#10A7FF] underline underline-offset-2 hover:text-[#2DE2FF]" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="border-l-2 border-[#10A7FF]/50 bg-white/3 rounded-r-lg pl-5 pr-4 py-3 my-6 text-slate-300 italic"
      {...props}
    />
  ),
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-6 rounded-xl border border-white/10">
      <table className="w-full text-sm text-left" {...props} />
    </div>
  ),
  th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="px-4 py-3 bg-white/5 text-slate-400 font-bold text-xs uppercase tracking-widest" {...props} />
  ),
  td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="px-4 py-3 border-t border-white/5 text-slate-300" {...props} />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="bg-[#0B1525] border border-white/10 rounded-xl p-4 my-6 overflow-x-auto text-sm text-slate-200" {...props} />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code className="text-[#2DE2FF] bg-white/5 rounded px-1.5 py-0.5 text-[0.85em]" {...props} />
  ),
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const guide = getGuide(slug)
  if (!guide) notFound()

  const { meta, content } = guide

  return (
    <div className="min-h-screen bg-[#04080F]">
      <Navbar />

      <article className="pt-32 pb-20 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto">
          <Link
            href="/resources"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft size={15} /> All resources
          </Link>

          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#2DE2FF' }}>
            {meta.category}
          </p>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight mb-4">
            {meta.title}
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed mb-5">{meta.description}</p>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 pb-8 mb-2 border-b border-white/5">
            <Clock size={13} /> {meta.minutes} min read
          </div>

          <div className="mt-8">
            <MDXRemote source={content} components={mdxComponents} />
          </div>
        </div>
      </article>

      <section className="pb-24 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto glass-card p-8 text-center">
          <h2 className="text-2xl font-black text-white tracking-tight mb-3">
            Put this into practice.
          </h2>
          <p className="text-slate-400 mb-7 max-w-md mx-auto">
            BidWise scores live auction properties with the exact math in these guides — comps, rehab, and a defensible max bid on every listing.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 btn-primary px-7 py-3 text-sm"
          >
            Start Free Trial <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  )
}
