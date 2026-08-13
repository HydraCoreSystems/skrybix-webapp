// Plain GET form -- no client JS needed, works the same as every other
// form in this app, and keeps the search term in the URL so a result is
// shareable/bookmarkable and survives a page refresh.
export default function SearchBox({ placeholder, defaultValue }: { placeholder: string; defaultValue?: string }) {
  return (
    <form className="search-bar" method="get">
      <input type="search" name="q" placeholder={placeholder} defaultValue={defaultValue} />
      <button className="btn secondary small" type="submit">
        Search
      </button>
      {defaultValue && (
        <a className="btn secondary small" href="?">
          Clear
        </a>
      )}
    </form>
  );
}
