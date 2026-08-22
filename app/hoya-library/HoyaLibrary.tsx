"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { markHoyaSpeciesCollected } from "./actions";
import {
  collectionProgress,
  displayBotanicalName,
  filterHoyaSpecies,
  type CollectionFilter,
  type HoyaSpeciesRecord,
} from "@/lib/hoya-library";

export default function HoyaLibrary({ records }: { records: HoyaSpeciesRecord[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [region, setRegion] = useState("");
  const deferredQuery = useDeferredValue(query);
  const progress = collectionProgress(records);
  const regions = useMemo(
    () => Array.from(new Set(records.map((record) => record.region_group).filter(Boolean) as string[])).sort(),
    [records]
  );
  const visible = useMemo(
    () => filterHoyaSpecies(records, deferredQuery, filter, region),
    [records, deferredQuery, filter, region]
  );

  return (
    <>
      <section className="hoya-library-hero">
        <div>
          <p className="eyebrow">Gathering Moss Collection Reference</p>
          <h1>Hoya Collection Library</h1>
          <p className="hero-copy">
            Explore the Kew/POWO-derived Hoya reference snapshot and see which species have been part of your collection.
          </p>
        </div>
        <div className="collection-progress" aria-label={`${progress.collected} of ${progress.total} species collected`}>
          <strong>{progress.collected}</strong>
          <span>of {progress.total} collected</span>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <small>{progress.percent}% of the reference list</small>
        </div>
      </section>

      <section className="library-controls" aria-label="Filter Hoya library">
        <label className="library-search">
          <span>Search the library</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Species, range, authority…"
          />
        </label>
        <div className="library-filter-group" aria-label="Collection status">
          {(["all", "collected", "not-collected"] as CollectionFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All species" : value === "collected" ? "In my collection" : "Not yet collected"}
            </button>
          ))}
        </div>
        <label>
          <span>Region</span>
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="">All regions</option>
            {regions.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      </section>

      <div className="library-result-line">
        <strong>{visible.length}</strong> {visible.length === 1 ? "species" : "species"} shown
      </div>

      {visible.length ? (
        <section className="species-grid">
          {visible.map((record) => (
            <article className={`species-card ${record.in_collection ? "collected" : ""}`} key={record.id}>
              <div className="species-card-heading">
                <div>
                  <p className="species-genus">{record.genus}</p>
                  <h2><i>{displayBotanicalName(record)}</i></h2>
                  {record.authority && <p className="species-authority">{record.authority}</p>}
                </div>
                {record.in_collection ? <span className="collection-badge">✓ Collected</span> : <span className="reference-badge">Reference</span>}
              </div>
              <dl className="species-facts">
                <div><dt>Native range</dt><dd>{record.native_range || "Not recorded"}</dd></div>
                {record.region_group && <div><dt>Region</dt><dd>{record.region_group}</dd></div>}
                {record.growth_habit && <div><dt>Growth habit</dt><dd>{record.growth_habit}</dd></div>}
                {record.date_added && <div><dt>First recorded</dt><dd>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${record.date_added}T00:00:00`))}</dd></div>}
              </dl>
              {(record.leaf_notes || record.bloom_notes) && (
                <div className="species-notes">
                  {record.leaf_notes && <p><strong>Leaves:</strong> {record.leaf_notes}</p>}
                  {record.bloom_notes && <p><strong>Blooms:</strong> {record.bloom_notes}</p>}
                </div>
              )}
              <div className="species-card-footer">
                <small>Source: {record.source || "Reference snapshot"}</small>
                {!record.in_collection && (
                  <form action={markHoyaSpeciesCollected.bind(null, record.id)}>
                    <button className="btn small secondary" type="submit">Mark collected</button>
                  </form>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="library-empty">
          <strong>No species match those filters.</strong>
          <p>Try clearing the search or choosing a different collection status.</p>
        </div>
      )}
    </>
  );
}
