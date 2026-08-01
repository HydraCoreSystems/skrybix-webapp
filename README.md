# Skrybix

Skrybix is Gathering Moss's plant inventory and label-printing application.
It remains the authority for mother-plant and cutting identities.

## GM Commerce export

`GET /api/commerce/v1/plants` returns a versioned, read-only JSON snapshot
of every cutting, including archived records so a downstream importer can
reconcile lifecycle state without treating an omitted record as deleted.

The route is protected by Skrybix's existing session middleware. Sign in to
Skrybix first, then request the endpoint with that authenticated browser
session (or its `skrybix_session` cookie). It has no separate API key and
performs no writes. Unauthenticated requests follow the normal redirect to
`/login`.

```json
{
  "export_version": "1.0",
  "source_system": "skrybix",
  "generated_at": "2026-08-01T00:00:00.000Z",
  "records": [
    {
      "source_system": "skrybix",
      "source_record_id": "HY-ABC01-C01",
      "plant_identity": "HY-ABC01-C01",
      "plant_record_type": "cutting",
      "display_name": "Hoya example",
      "parent_source_record_id": "HY-ABC01",
      "is_active": true,
      "is_sold": false,
      "archived_at": null,
      "source_created_at": "2026-08-01T00:00:00.000Z"
    }
  ]
}
```

`plant_identity` is the existing, permanent Skrybix `cutting_id`; it is
deliberately not labelled as a commerce SKU. Skrybix has no separate
commerce-SKU field. `is_active` means only that `archived_at` is null, not
that a cutting has been approved or listed for sale. Likewise, `is_sold`
reports Skrybix's existing sold flag and is not a marketplace inventory
quantity.

The current schema has no source `updated_at` field for cuttings, no
commerce SKU, no listing-readiness field, and no reliable sale-availability
field. Those facts are intentionally absent from this export rather than
inferred. GM Commerce may retain the source identity and own later commerce
workflow state, but must not write that state back through this endpoint.
