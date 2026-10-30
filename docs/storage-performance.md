# Recovery journal performance

Run the reproducible synthetic benchmark with:

```sh
node scripts/benchmark-journal.mjs
```

It generates a fictional eight-player history and records 12 successive scoring
changes on one current match. It measures synchronous JSON serialization versus
the complete compact-journal update. IndexedDB transactions and physical device
storage latency are excluded; `localStorage` is an in-memory adapter. Results are
diagnostic measurements on the cloud worker, not phone performance guarantees.

An observed run produced:

| Historical matches | Full snapshot | Compact journal | Full serialization average | Compact update average |
| ------------------ | ------------: | --------------: | -------------------------: | ---------------------: |
| 100                |        248 KB |          1.3 KB |                    1.99 ms |                0.23 ms |
| 1,000              |      2,520 KB |          1.3 KB |                   23.76 ms |                0.56 ms |
| 5,000              |     12,762 KB |          1.3 KB |                  126.49 ms |                4.07 ms |

## Why recovery remains safe

The main IndexedDB snapshot remains a full restorable dataset. A synchronous
recovery journal records full replacements of changed player, session, or match
records, along with deletions and record order when needed. It accumulates every
record touched until the latest snapshot commits. Reverting a change therefore
still records the final value, even if an intermediate snapshot has already been
saved.

An overlay records its base generation and the intervening save IDs. Recovery
applies it only over the matching base or a known intermediate snapshot. A
missing or unrelated base raises a visible recovery error instead of combining
unrelated histories. Older queued-save acknowledgements cannot erase a newer
pending journal. Existing full recovery journals remain supported, and an
unknown save lineage falls back to a full journal.

The first save, imported/replaced histories, and very large batches can still
require a full journal. Local-storage quota failure is reported; IndexedDB saves
and downloaded backups remain important. This optimization does not make
anonymous Sheets synchronization a multi-writer database.
