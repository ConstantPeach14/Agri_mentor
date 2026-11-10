-- Adds a simple self-managed availability note without introducing a calendar.
-- Do not apply without separate explicit approval and an authorised target.

ALTER TABLE mentor_profiles
  ADD COLUMN availability_note TEXT NOT NULL DEFAULT ''
    CHECK (char_length(availability_note) <= 500);
