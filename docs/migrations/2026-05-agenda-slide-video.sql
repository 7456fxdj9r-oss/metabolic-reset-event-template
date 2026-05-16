-- Sub-slide videos: short testimonial clips played from the projector
-- deck on a specific agenda segment. The existing image_url is still
-- the slide's image; the new video_url is optional and overlays the
-- image when present. Browser renders <video poster=image_url> with
-- the image as a built-in fallback if the video codec fails.
--
-- Idempotent: safe to re-run.

alter table agenda_slides
  add column if not exists video_url text;
