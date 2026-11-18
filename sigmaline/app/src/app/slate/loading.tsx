export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading slate" className="mx-auto max-w-3xl px-4 pt-4">
      <div className="skeleton mb-3 h-8 w-40" />
      <div className="skeleton mb-4 h-10 w-full" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="mb-2 grid grid-cols-[54px_1fr_64px_74px] gap-2">
          <div className="skeleton h-12" />
          <div className="skeleton h-12" />
          <div className="skeleton h-12" />
          <div className="skeleton h-12" />
        </div>
      ))}
    </div>
  );
}
