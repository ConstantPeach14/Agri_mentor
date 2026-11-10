-- Migration body for the proposed auth/profile schema.
-- Execute only through the reviewed migration runner: one transaction,
-- a PostgreSQL advisory lock, and a schema_migrations ledger check are required.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by TEXT NOT NULL DEFAULT current_user
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('mentee', 'mentor', 'programme_staff')),
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending', 'active', 'suspended', 'closed')),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, role)
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));
CREATE INDEX users_role_status_idx ON users (role, account_status);

CREATE TABLE mentee_profiles (
  user_id UUID PRIMARY KEY,
  account_role TEXT NOT NULL DEFAULT 'mentee' CHECK (account_role = 'mentee'),
  location TEXT NOT NULL DEFAULT '',
  biography TEXT NOT NULL DEFAULT '',
  agricultural_background TEXT NOT NULL DEFAULT '',
  experience_level TEXT NOT NULL DEFAULT '',
  needs TEXT NOT NULL DEFAULT '',
  cloudinary_public_id TEXT,
  image_url TEXT CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((cloudinary_public_id IS NULL) = (image_url IS NULL)),
  FOREIGN KEY (user_id, account_role) REFERENCES users (id, role)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE mentor_profiles (
  user_id UUID PRIMARY KEY,
  account_role TEXT NOT NULL DEFAULT 'mentor' CHECK (account_role = 'mentor'),
  location TEXT NOT NULL DEFAULT '',
  biography TEXT NOT NULL DEFAULT '',
  experience_years SMALLINT CHECK (experience_years BETWEEN 0 AND 100),
  specialisation TEXT NOT NULL DEFAULT '',
  qualifications_summary TEXT NOT NULL DEFAULT '',
  cloudinary_public_id TEXT,
  image_url TEXT CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((cloudinary_public_id IS NULL) = (image_url IS NULL)),
  FOREIGN KEY (user_id, account_role) REFERENCES users (id, role)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE programme_staff_profiles (
  user_id UUID PRIMARY KEY,
  account_role TEXT NOT NULL DEFAULT 'programme_staff'
    CHECK (account_role = 'programme_staff'),
  organization TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
    cloudinary_public_id TEXT,
    image_url TEXT CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((cloudinary_public_id IS NULL) = (image_url IS NULL)),
  FOREIGN KEY (user_id, account_role) REFERENCES users (id, role)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE expertise (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX expertise_name_lower_unique ON expertise (lower(name));

CREATE TABLE mentor_expertise (
  mentor_user_id UUID NOT NULL REFERENCES mentor_profiles(user_id) ON DELETE RESTRICT,
  expertise_id UUID NOT NULL REFERENCES expertise(id) ON DELETE RESTRICT,
  PRIMARY KEY (mentor_user_id, expertise_id)
);
CREATE INDEX mentor_expertise_by_expertise_idx ON mentor_expertise (expertise_id, mentor_user_id);

CREATE TABLE mentee_interests (
  mentee_user_id UUID NOT NULL REFERENCES mentee_profiles(user_id) ON DELETE RESTRICT,
  expertise_id UUID NOT NULL REFERENCES expertise(id) ON DELETE RESTRICT,
  PRIMARY KEY (mentee_user_id, expertise_id)
);
CREATE INDEX mentee_interests_by_expertise_idx ON mentee_interests (expertise_id, mentee_user_id);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_expiry_idx ON auth_sessions (user_id, expires_at);

CREATE TABLE agricultural_images (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cloudinary_public_id TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL CHECK (image_url LIKE 'https://%'),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agricultural_images_owner_created_idx ON agricultural_images (owner_user_id, created_at DESC);

CREATE FUNCTION prevent_user_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'A registered account role is permanent'
      USING ERRCODE = '23514', CONSTRAINT = 'users_role_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_role_is_immutable
BEFORE UPDATE OF role ON users
FOR EACH ROW
EXECUTE FUNCTION prevent_user_role_change();

CREATE FUNCTION prevent_user_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Accounts must be closed or anonymized, not deleted'
    USING ERRCODE = '23514', CONSTRAINT = 'users_are_not_deleted';
  RETURN OLD;
END;
$$;

CREATE TRIGGER users_are_not_deleted
BEFORE DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION prevent_user_deletion();

CREATE FUNCTION require_matching_role_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_user_id UUID;
  user_role TEXT;
  has_required_profile BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    affected_user_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    affected_user_id := OLD.user_id;
  ELSE
    affected_user_id := NEW.user_id;
  END IF;

  SELECT role
    INTO user_role
    FROM users
   WHERE id = affected_user_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  CASE user_role
    WHEN 'mentee' THEN
      SELECT EXISTS (
        SELECT 1 FROM mentee_profiles WHERE user_id = affected_user_id
      ) INTO has_required_profile;
    WHEN 'mentor' THEN
      SELECT EXISTS (
        SELECT 1 FROM mentor_profiles WHERE user_id = affected_user_id
      ) INTO has_required_profile;
    WHEN 'programme_staff' THEN
      SELECT EXISTS (
        SELECT 1 FROM programme_staff_profiles WHERE user_id = affected_user_id
      ) INTO has_required_profile;
    ELSE
      has_required_profile := FALSE;
  END CASE;

  IF NOT has_required_profile THEN
    RAISE EXCEPTION 'Account % must have the profile required for role %',
      affected_user_id, user_role
      USING ERRCODE = '23514', CONSTRAINT = 'users_require_matching_role_profile';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER users_require_matching_role_profile
AFTER INSERT OR UPDATE ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_matching_role_profile();

CREATE CONSTRAINT TRIGGER mentee_profiles_require_user_profile
AFTER INSERT OR UPDATE OR DELETE ON mentee_profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_matching_role_profile();

CREATE CONSTRAINT TRIGGER mentor_profiles_require_user_profile
AFTER INSERT OR UPDATE OR DELETE ON mentor_profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_matching_role_profile();

CREATE CONSTRAINT TRIGGER programme_staff_profiles_require_user_profile
AFTER INSERT OR UPDATE OR DELETE ON programme_staff_profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION require_matching_role_profile();
