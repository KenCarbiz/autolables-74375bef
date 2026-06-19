-- Vehicle photo for the inventory thumbnail + the vehicle-file hero/carousel.
-- Two writers fill it: marketcheck-sync (from the feed's media.photo_links) and
-- crawl-advertised-prices (og:image scraped off the dealer's own VDP, which is
-- usually the higher-quality, CDN-stable source).

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS hero_image_url text;
