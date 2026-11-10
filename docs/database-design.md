# Proposed PostgreSQL data model

**Status: proposal only.** No database provider or production database has been
confirmed. This document does not create tables, connect to a database, or run
migrations. Review the design before implementation.

## Entities and relationships

- `users` is the single identity record for every account. Its `role` is
  `mentee`, `mentor`, or `programme_staff`.
- `mentor_profiles` and `mentee_profiles` each have a one-to-one relationship
  with `users` through a unique `user_id` foreign key.
- `expertise` stores reusable skills; `mentor_expertise` joins mentors to
  expertise in a many-to-many relationship.
- `mentorship_requests` links one mentee profile to one mentor profile. A
  request can have many sessions and goals.
- `mentorship_sessions` belong to a request and store scheduled and completed
  meeting details.
- `goals` belong to a request. Each goal can have multiple `progress_records`,
  each authored by a user.

## Proposed columns and constraints

| Table | Proposed fields and constraints |
|---|---|
| `users` | `id UUID PRIMARY KEY`; `email CITEXT UNIQUE NOT NULL`; `full_name TEXT NOT NULL`; `role TEXT NOT NULL CHECK (role IN ('mentee', 'mentor', 'programme_staff'))`; `created_at`, `updated_at TIMESTAMPTZ NOT NULL`; optional `is_active BOOLEAN NOT NULL DEFAULT TRUE`. |
| `mentor_profiles` | `user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`; optional `bio`, `location`, `years_experience`; timestamps. Application validation should require the linked user's role to be `mentor`. |
| `mentee_profiles` | `user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`; optional `bio`, `location`, `farm_or_business_name`, `experience_level`; timestamps. Application validation should require the linked user's role to be `mentee`. |
| `expertise` | `id UUID PRIMARY KEY`; `name TEXT NOT NULL UNIQUE`; optional `description`. |
| `mentor_expertise` | `mentor_user_id UUID REFERENCES mentor_profiles(user_id) ON DELETE CASCADE`; `expertise_id UUID REFERENCES expertise(id) ON DELETE RESTRICT`; composite primary key `(mentor_user_id, expertise_id)`. |
| `mentorship_requests` | `id UUID PRIMARY KEY`; `mentee_user_id UUID REFERENCES mentee_profiles(user_id) ON DELETE RESTRICT`; `mentor_user_id UUID REFERENCES mentor_profiles(user_id) ON DELETE RESTRICT`; `message TEXT NOT NULL`; `status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'completed'))`; timestamps. |
| `mentorship_sessions` | `id UUID PRIMARY KEY`; `request_id UUID NOT NULL REFERENCES mentorship_requests(id) ON DELETE CASCADE`; `starts_at TIMESTAMPTZ NOT NULL`; optional `ends_at`, `notes`; `status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled'))`; timestamps; check `ends_at IS NULL OR ends_at > starts_at`. |
| `goals` | `id UUID PRIMARY KEY`; `request_id UUID NOT NULL REFERENCES mentorship_requests(id) ON DELETE CASCADE`; `title TEXT NOT NULL`; optional `description`, `due_at`; `status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'cancelled'))`; timestamps. |
| `progress_records` | `id UUID PRIMARY KEY`; `goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE`; `author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`; `note TEXT NOT NULL`; optional `completion_percent SMALLINT CHECK (completion_percent BETWEEN 0 AND 100)`; `created_at TIMESTAMPTZ NOT NULL`. |

Use database-generated UUIDs and timestamps when the selected PostgreSQL
provider is known. Add indexes to foreign-key columns used for joins and
queries. Enforce role/profile consistency and request participant permissions
in the service layer or with carefully reviewed database constraints. Consider
a partial unique index to prevent duplicate pending requests only after the
desired product behavior is confirmed.

`CITEXT` is an optional PostgreSQL extension for case-insensitive email
uniqueness; alternatively normalize email addresses in application code and use
a unique index on the normalized value.
