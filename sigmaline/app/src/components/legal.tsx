import { Footer, Header, Main } from './chrome';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <Header nav="public" />
      <Main>
        <article className="prose-sl mx-auto max-w-2xl px-4 pt-4 text-[15px] leading-relaxed [&_h2]:mt-6 [&_h2]:font-mono [&_h2]:text-[12px] [&_h2]:uppercase [&_h2]:tracking-[0.14em] [&_h2]:text-amber [&_li]:mt-1 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
          <h1 className="font-mono text-[20px] font-semibold">{title}</h1>
          <p className="text-[12px] text-muted">Last updated {updated}. Draft — to be reviewed by a lawyer before scaling.</p>
          {children}
        </article>
      </Main>
      <Footer />
    </>
  );
}
