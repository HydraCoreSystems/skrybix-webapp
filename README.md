# Skrybix

Skrybix is Gathering Moss's plant inventory and label-printing application.
It remains the authority for mother-plant and cutting identities.

## GM Commerce handoff

Skrybix remains the source of truth for cutting identity. In **Cuttings**, a
human checks **Select for GM Commerce** beside an existing cutting. This
persists `commerce_selected_at` on that original source record; it does not
create, modify, or manually re-enter a SKU.

The existing Skrybix `cutting_id` is the only durable SKU-like identifier
available for every cutting, so the handoff returns that unchanged value as
both `sourceRecordId` and `sku`. Skrybix has no separate commerce-SKU field
and does not generate one for this integration.

### Access and setup

Apply the updated `supabase/schema.sql` to add the durable selection and
acknowledgement columns. Set a non-empty `COMMERCE_EXPORT_KEY` in the
Skrybix deployment environment, using a unique random value such as:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Do not commit the key. GM Commerce sends it on every request:

```http
Authorization: Bearer <COMMERCE_EXPORT_KEY>
```

The API route is intentionally excluded from Skrybix's browser-session
middleware so GM Commerce can use this bearer credential. The route itself
fails closed with `401` unless the configured token exactly matches; it does
not provide Supabase access, browser-session access, or source-record write
access to GM Commerce other than the documented acknowledgement timestamp.

| Operation | Endpoint | Result |
| --- | --- | --- |
| Read pending selections | `GET /api/commerce/v1/plants` | Returns only human-selected, unacknowledged cutting records. |
| Acknowledge an imported record | `POST /api/commerce/v1/plants/:cuttingId/acknowledge` | Durably marks that selected source record acknowledged. Repeating it is safe. |

```json
{
  "exportVersion": "1.0",
  "sourceSystem": "skrybix",
  "retrievedAt": "2026-08-01T00:00:00.000Z",
  "records": [
    {
      "sourceSystem": "skrybix",
      "sourceRecordId": "HY-ABC01-C01",
      "sku": "HY-ABC01-C01",
      "displayName": "Hoya example",
      "parentSourceRecordId": "HY-ABC01",
      "plantRecordType": "cutting",
      "state": "active",
      "selectionState": "selected",
      "selectedAt": "2026-08-01T00:00:00.000Z",
      "acknowledgedAt": null,
      "archivedAt": null,
      "sourceCreatedAt": "2026-08-01T00:00:00.000Z"
    }
  ]
}
```

`state` truthfully reports the current source lifecycle: `active`, `sold`, or
`archived`. It is not marketplace availability or inventory quantity.
`displayName` is the stored source display name, not a generated listing
title. The source has no cutting `updated_at`, listing-readiness field,
price, quantity, photo folder, or marketplace data, so none is inferred.

GM Commerce must import idempotently on `sourceSystem` plus `sourceRecordId`,
then call the acknowledgement route after its own durable intake succeeds.
An acknowledged cutting remains visibly acknowledged in Skrybix but is no
longer returned by the pending-selection response. There is no callback,
two-way synchronization, or GM Commerce write access beyond that narrow
acknowledgement timestamp; GM Commerce owns all downstream commerce state.

GMCOM-003 commerce-selection handoff deployed.
