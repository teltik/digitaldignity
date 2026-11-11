# digitaldignity.online

One static page (`index.html`). No build step, no server, no database.

## Recommended hosting: DigitalOcean App Platform, free tier

A $6 Droplet is more than this needs and means patching a server. App Platform hosts up to 3 static sites free, with HTTPS, a CDN and your custom domain. The free tier includes 1 GiB of outbound transfer per month; photos are served from the Unsplash CDN, so only the page itself counts against that.

### 1. Put the site in GitHub
1. Create a repo, for example `digital-dignity-site` (private is fine).
2. Upload `index.html` and this README to the root.

### 2. Turn on the contact form (Web3Forms, free)
1. Go to https://web3forms.com, enter the inbox that should receive messages, and copy the access key they email you.
2. In `index.html`, find `const WEB3FORMS_ACCESS_KEY = "";` near the bottom and paste the key between the quotes. Commit.
3. Free plan: 250 submissions a month, spam filtering included. Nonprofit plan is $49 a year if you ever need more.

### 3. Create the app
1. DigitalOcean > Create > App Platform > GitHub > pick the repo, branch `main`.
2. When it detects the component, set it to **Static Site**. Build command: leave empty. Output directory: `/`.
3. Plan: Free. Create.

### 4. Point the domain
1. App > Settings > Domains > Add `digitaldignity.online` (and `www.digitaldignity.online`).
2. Easiest: let DigitalOcean manage DNS and change the nameservers at your registrar to `ns1.digitalocean.com`, `ns2.digitalocean.com`, `ns3.digitalocean.com`.
3. Or keep DNS where it is and add the CNAME records the App Platform screen shows you.
4. HTTPS is issued automatically once DNS resolves.

Every push to `main` redeploys the site.

## If you prefer the $6 Droplet anyway
Ubuntu Droplet, then:
```
sudo apt install -y caddy
sudo mkdir -p /var/www/dd && sudo cp index.html /var/www/dd/
echo 'digitaldignity.online, www.digitaldignity.online {
  root * /var/www/dd
  file_server
  encode gzip
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
Point the A records for `@` and `www` to the Droplet IP. Caddy gets the certificate on its own. The form still uses Web3Forms.

## Photos
Real photographs from Unsplash (free for commercial use, no attribution required), loaded from Unsplash's CDN. Before launch, the strongest upgrade is swapping them for photos of your own households and partners, with their written permission. Replace the `src` URLs, or add an `images/` folder and point to it.

| Spot | Unsplash photo |
|---|---|
| Hero | https://unsplash.com/photos/sbHo9rRSIZc |
| Students | https://unsplash.com/photos/6MePtA9EVDA |
| Seniors | https://unsplash.com/photos/UWZNnNQjraI |
| Families | https://unsplash.com/photos/DO0UCGoaXcQ |
| Partner | https://unsplash.com/photos/l66zs2XFqqs |
| Contact | https://unsplash.com/photos/JPkwTzxIfGg |

## Coverage checker
`coverage.js` powers the address checker in the Coverage section. Data comes from the FCC National Broadband Map (June 30, 2026 filing, H3 hexagons) and lives in `coverage/`:
- `us-5g-1.bin` to `us-5g-3.bin` and `us-lte-1.bin` to `us-lte-3.bin`: national overview cells (H3 resolution 5), split by how much of each cell is covered (1 light, 2 partial, 3 most)
- `sXX.bin` (5G-NR 7/1 Mbps) and `sXX-lte.bin` (4G LTE 5/1 Mbps): per state cells, XX is the state FIPS code (resolution 4 to 8, compacted)

Each file is a list of 64-bit H3 cell IDs, little endian. Addresses are looked up with OpenStreetMap Nominatim. The FCC publishes new filings every six months; refresh the files when a new one is out.
