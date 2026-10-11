# Custom store domains

How a shop opens its online store on its own domain, like `shop.example.com`, and how to set a server up for it.

The app checks the domain's DNS. Traefik routes the domain and gets its SSL certificate.
Nobody adds a domain to the proxy by hand.

Details of the feature: [features/online-store.md](../features/online-store.md) › Custom domain.

## Where the code is

| What | Where |
|---|---|
| The DNS check and the Traefik file | `app/services/sales/Domain.Service.ts` |
| Names in the file, the cron, the TXT label | `app/constants/Domain.Constant.ts` |
| The settings | `config/app.ts` › `domains` |
| The job | `app/jobs/Job.Registry.ts` (cron `domains`) |
| The form's rules | `app/validators/Store.Validator.ts` |
| Finding a shop by host | `ShopRepository.findByHost` / `findByDomain` |
| The proof value | `domainToken()` in `app/helpers/crypto.ts` |
| A ready setup | `docker-compose.yml` |

## How it works

1. The shop owner types the domain on `/online-store` › General and saves.
2. The page shows the DNS records to add, and the status **Waiting for DNS**. The records are:
   - a CNAME or an A record that points at this server
   - a TXT record `_sellrika.<domain>`
3. Every 5 minutes (`DOMAIN_CRON`) the app looks up every shop's domain. **Check now** (`POST /online-store/domain/check`) and a save that changes the domain run it at once.
4. A domain goes live when both are true:
   - every address it resolves to is an address of `DOMAIN_CNAME`
   - its TXT record holds this shop's value
5. The app writes all live domains into one Traefik file.
6. Traefik reads the file at once and asks Let's Encrypt for a certificate.
7. The page shows **Live**.

The feature is on only while `DOMAIN_CNAME` is set. With it empty, the app checks nothing and writes no file.

### The file is only a copy

- The list of domains lives in the `shops` table (`shops.domain`, `shops.domain_status`).
- The Traefik file is only a copy of it.
- The app builds the whole file again on every run. It writes it only when it changed.
- So the file needs no backup. If it is deleted, it comes back on the next run.
- The file is written to a hidden temp file first, then renamed. So Traefik never reads half a file.

### When a domain stops being live

- A live domain stays live while it points here. The TXT record is not asked for again.
- A domain that moved away goes back to pending. When it comes back, it needs the TXT record.
- A failed lookup keeps a live domain live. So a DNS problem never takes a store down.

### `www`

- The form drops every leading `www.` from what the owner types.
- The app also routes `www.<domain>`, but only when that name points here too.
- Each host gets its own router and its own certificate. So a `www.` that fails can never block the main domain.

## Proof that the domain is yours

Without a proof, one shop could save a domain that another person had already pointed at the server. That domain would then show the wrong store.

So the TXT record `_sellrika.<domain>` (`DOMAIN_TXT_LABEL`) must hold `domainToken(shop id, domain)`.

- The value looks like `sellrika-verify=<HMAC with APP_KEY>`.
- Another shop can not make that value.

Rules:

- **A pending domain blocks nobody.** When another shop saves the same domain, it is taken away from the pending shop (`ShopRepository.releaseDomain`).
- **A live domain is taken.** Nobody else can save it.
- **A pending domain serves nothing.** While `DOMAIN_CNAME` is set, `ShopRepository.findByHost` and `findByDomain` match only a live domain.
- **The exact host wins.** The shop that saved the exact host comes before the one found by dropping `www.`.

## Hosts a shop may not use

The form refuses the app's own hosts (`isOwnHost` in `app/validators/Store.Validator.ts`):

- the host of `APP_URL`
- `STORE_DOMAIN`
- `DEVELOPER_DOMAIN`
- `DOMAIN_CNAME`
- every name under one of them
- any domain that contains the app's own domain (`PLATFORM_DOMAIN`), so no shop can pose as the platform

## Free store addresses

Every open store also has a free address: `<slug>.<STORE_DOMAIN>`.

- The same run adds each open store's subdomain to the Traefik file.
- So each store gets its own certificate.
- This needs a wildcard DNS record `*.<STORE_DOMAIN>` that points at the server.

Let's Encrypt allows only 50 new certificates a week for one registered domain.
So a busy week of new stores could wait for SSL.
The fix is one wildcard certificate: see [Wildcard certificate](#wildcard-certificate-for-the-free-store-addresses).

## Server setup with the public `docker-compose.yml`

The `docker-compose.yml` in the repo runs the app behind a plain Traefik. It is ready for custom domains.

What it sets up:

- Traefik with the Docker provider and the file provider. The file provider watches `/dynamic`.
- A shared volume `traefik-dynamic`. Traefik reads it at `/dynamic`. The app writes it at `/traefik`.
- The entrypoints `http` (port 80) and `https` (port 443).
- A certificate resolver `letsencrypt` with the HTTP challenge.
- A volume `letsencrypt` that holds every certificate. Keep this volume.
- On the app: `TRUST_PROXY=1`, `TRAEFIK_FILE=/traefik/sellrika-shops.yaml`, `TRAEFIK_APP_URL=http://app:3000`.

Steps:

1. **DNS.** Point three names at the server:
   - the app's own host, like `pos.example.com`
   - the target for custom domains, like `stores.example.com`
   - a wildcard for the free addresses, like `*.shop.example.com`
2. **`.env`** next to the compose file:

   ```sh
   APP_HOST=pos.example.com
   ACME_EMAIL=you@example.com
   APP_URL=https://pos.example.com
   STORE_DOMAIN=shop.example.com
   DOMAIN_CNAME=stores.example.com
   ```

3. **Start.** `docker compose up -d --build`

If you use Cloudflare for DNS, set the target record to **DNS only** (grey cloud).
A proxied target makes a merchant's CNAME to it fail with Cloudflare error 1014.

## Server setup with your own Traefik

You need three things.

1. **A folder that Traefik's file provider watches**, mounted into the app.
   `TRAEFIK_FILE` must be a file inside that folder.
2. **`DOMAIN_CNAME`** = the host shop owners point their domain at. It must resolve to this server.
3. **The names your Traefik uses**, when they differ from the defaults below.

## Settings

| Variable | Default | What it is |
|---|---|---|
| `DOMAIN_CNAME` | empty | The host shop owners point their own domain at. Empty = custom domains are off. |
| `STORE_DOMAIN` | `localhost` | Every shop's free address is `<slug>.<STORE_DOMAIN>`. |
| `TRAEFIK_FILE` | `/traefik/sellrika-shops.yaml` | The file the app writes. Traefik's file provider must watch its folder. |
| `TRAEFIK_APP_URL` | `http://<container name>:<PORT>` | Where Traefik reaches the app. It is used by the file's own service. |
| `TRAEFIK_SERVICE` | empty | The name of a Traefik service that already reaches the app. Empty = the file brings its own, with `TRAEFIK_APP_URL`. |
| `TRAEFIK_HTTP_ENTRYPOINT` | `http` | The entrypoint for port 80. Many setups name it `web`. |
| `TRAEFIK_HTTPS_ENTRYPOINT` | `https` | The entrypoint for port 443. Many setups name it `websecure`. |
| `TRAEFIK_CERT_RESOLVER` | `letsencrypt` | The Let's Encrypt certificate resolver. |
| `STORE_WILDCARD_RESOLVER` | empty | The name of a resolver that uses the DNS challenge. Set = one wildcard certificate for every free store address. |

## What is in the Traefik file

`DomainService.traefikConfig` builds it. It is written as JSON, which is valid YAML.

The file stands alone. It needs nothing from the proxy's other files.

| Part | Name | What it does |
|---|---|---|
| A router per host | `sellrika-shop-<host with dashes>` | https, with a certificate from `TRAEFIK_CERT_RESOLVER` |
| A second router per host | `…-http` | Sends http to https |
| Middleware | `sellrika-shop-redirect` | The redirect to https |
| Middleware | `sellrika-shop-gzip` | Compresses answers |
| Service | `sellrika-shop-app` | Points at `TRAEFIK_APP_URL`. Left out when `TRAEFIK_SERVICE` names one. |

The names are in `TRAEFIK` (`app/constants/Domain.Constant.ts`). All start with `sellrika-shop-`, so they never clash.

## Wildcard certificate for the free store addresses

A wildcard certificate (`*.shop.example.com`) can only be made with the **DNS challenge**.
Traefik proves the domain by writing a TXT record through your DNS provider's API.
The HTTP challenge can not make a wildcard.
So Traefik needs a second resolver.

1. **Get an API token from your DNS provider.** It must be allowed to change DNS records of the zone.
2. **Add a resolver to Traefik.** Add these lines to its `command:`. Replace `<provider>` with your DNS provider's name in Traefik:

   ```yaml
   - --certificatesresolvers.dns.acme.dnschallenge=true
   - --certificatesresolvers.dns.acme.dnschallenge.provider=<provider>
   - --certificatesresolvers.dns.acme.email=${ACME_EMAIL}
   - --certificatesresolvers.dns.acme.storage=/letsencrypt/acme.json
   ```

   Give Traefik the token as an environment variable. Its name depends on the provider. See Traefik's docs.
   Then restart the proxy.
3. **Tell the app.** Set `STORE_WILDCARD_RESOLVER=dns` (the resolver's name from step 2). Restart the app.
4. **Check.** Within 5 minutes the Traefik file holds a router `sellrika-shop-wildcard` and no router per store.
   Open a store. The certificate is for `*.shop.example.com`.
   If it is not, read the proxy's log and look for `acme`.

What changes in the app while `STORE_WILDCARD_RESOLVER` is set (`DomainService.run`, `traefikConfig`):

- One router serves every free address. Its rule is `HostRegexp(^[a-z0-9-]+\.shop\.example\.com$)`.
- Its `tls.domains` are `shop.example.com` and `*.shop.example.com`.
- A store that is off still answers "not found" from the app.
- Custom domains keep their own router and their own certificate from `TRAEFIK_CERT_RESOLVER`.
- The limit on store address renames (`SLUG_CHANGES_PER_WEEK`) is not applied. A rename needs no certificate.

To go back, remove the variable and restart. The app writes one router per open store again.

## Check it works

On the server:

```sh
docker compose exec app cat /traefik/sellrika-shops.yaml   # the routed hosts
docker compose logs app | grep '\[domains\]'               # warnings
```

| Warning | What it means |
|---|---|
| `[domains] <folder> is missing` | The folder of `TRAEFIK_FILE` is not mounted into the app. |
| `[domains] <DOMAIN_CNAME> does not resolve` | The DNS record of `DOMAIN_CNAME` is missing. |

## What the shop owner does

The page shows these steps too. It shows the real host and address to use.

- **A subdomain** (`shop.example.com`): add a `CNAME` for `shop` that points at the `DOMAIN_CNAME` host.
- **A root domain** (`example.com`): add an `A` record for `@` with the server's address. Most DNS providers do not allow a CNAME on the root.
- **The proof**: add the `TXT` record `_sellrika.<domain>` with the value the page shows.
- **Also `www`**: add the same record for `www`. The app routes `www.` only when it points here too.
- **Delete any other A or AAAA record on the same name.** Let's Encrypt may try any of them and fail.
- **Cloudflare users**: set the record to "DNS only" (grey cloud).
- **Customer sign-in** (Firebase): add the domain in Firebase › Authentication › Settings › Authorized domains. See [firebase-setup.md](firebase-setup.md).

## A domain stays "Waiting for DNS"

The page shows what the domain points at now.

| The page says | What is wrong |
|---|---|
| "does not point anywhere yet" | The record is missing, or the DNS change has not spread yet. Wait up to a few hours. |
| Cloudflare addresses (`104.x`, `172.67.x`) | The owner's record is proxied. Set it to DNS only. |
| The server's address and another one | A second A or AAAA record is left over. Delete it. |
| Only another address | The record points at the wrong place, often the registrar's parking page. |
| The right address, and still waiting | The TXT record is missing or holds another value. |

If the page says **Live** but the store does not open with https, read Traefik's log and look for `acme`.
