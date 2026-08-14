# Example: Acme Supply

Customer-app surface for Memstream demos. Writes to the same Cockroach application DB that Memstream indexes.

```bash
# Terminal A — Memstream console
make web          # http://127.0.0.1:3000

# Terminal B — this shop
make shop         # http://127.0.0.1:3001
```

On EC2: Caddy serves HTTPS — console at `https://<ip>.sslip.io/`, shop at `https://shop.<ip>.sslip.io/` (free sslip.io hostnames + Let's Encrypt).
