# Memstream console (Next.js)

Product UI + demo shop. APIs are Next Route Handlers.

```bash
make install-js
make web
# http://127.0.0.1:3000       console (Live + Connect / Configure / Enable)
# http://127.0.0.1:3000/shop  demo shop
```

### Shop backends

| Mode | How | Writes |
| --- | --- | --- |
| **In-memory** (default) | No Connect / no app DB | CDC files under `data/cdc/inbox` |
| **Cockroach** | Save application URL in **Connect** (or set `SHOP_BACKEND=cockroach` with a URL the app can resolve) | Real table updates → changefeed → S3 |

Platform DB (`MEMSTREAM_DATABASE_URL` in repo-root `.env`) is required for Connect, Enable, and Live chunk history — not for a first look at `/shop`.

See the root [README](../../README.md) for the local vs cloud paths.
