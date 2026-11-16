'use client';
// Last-resort screen: if the app ever hits an unexpected error, offer a way back instead of a blank page.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="app">
      <div className="empty">
        <p><b>Something went wrong on this screen.</b></p>
        <p>Your saved history is safe. Try again, or reload the app.</p>
        <p>
          <button className="btn" onClick={() => reset()}>Try again</button>{' '}
          <button className="btn ghost" onClick={() => location.reload()}>Reload</button>
        </p>
      </div>
    </div>
  );
}
