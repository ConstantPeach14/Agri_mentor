const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const migration = readFileSync(
  path.resolve(__dirname, '../migrations/005_programme_oversight.sql'),
  'utf8',
);
const coordinationMigration = readFileSync(
  path.resolve(__dirname, '../migrations/007_staff_programme_coordination.sql'),
  'utf8',
);

test('pending invitation uniqueness excludes used and revoked invitations', () => {
  assert.match(migration, /revoked_at TIMESTAMPTZ/);
  assert.match(migration, /CHECK \(used_at IS NULL OR revoked_at IS NULL\)/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX programme_staff_invitations_pending_email_programme_idx[\s\S]*?WHERE used_at IS NULL AND revoked_at IS NULL;/,
  );
});

test('scope-linking triggers require fresh READ COMMITTED snapshots and share a transaction lock', () => {
  const triggerFunctions = [
    'link_request_to_shared_programmes',
    'link_relationship_to_shared_programmes',
    'link_participant_relationships_to_programme',
  ];
  for (const name of triggerFunctions) {
    const functionSql = migration.match(
      new RegExp(`CREATE FUNCTION ${name}\\(\\)[\\s\\S]*?\\$\\$;`),
    )?.[0];
    assert.ok(functionSql, `missing ${name} trigger function`);
    assert.match(functionSql, /VOLATILE/);
    assert.match(functionSql, /current_setting\('transaction_isolation'\) <> 'read committed'/);
    assert.match(functionSql, /USING ERRCODE = '0A000'/);
    assert.match(functionSql, /pg_advisory_xact_lock\(734205, 5\)/);
    assert.ok(
      functionSql.indexOf('pg_advisory_xact_lock') < functionSql.indexOf('INSERT INTO'),
      `${name} must acquire the shared lock before linking scope rows`,
    );
    assert.match(functionSql, /ON CONFLICT \(programme_id, (?:request_id|relationship_id)\) DO NOTHING/);
  }
});

test('Staff match proposals preserve programme scope, participant consent, audit, and capacity checks', () => {
  assert.match(coordinationMigration, /CREATE TABLE programme_match_proposals/);
  assert.match(coordinationMigration, /proposed_by_staff_user_id UUID NOT NULL/);
  assert.match(coordinationMigration, /FOREIGN KEY \(programme_id, mentee_user_id, mentee_role\)/);
  assert.match(coordinationMigration, /FOREIGN KEY \(programme_id, mentor_user_id, mentor_role\)/);
  assert.match(coordinationMigration, /mentee_response TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(coordinationMigration, /mentor_response TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(coordinationMigration, /programme_match_proposal_events/);
  assert.match(coordinationMigration, /CREATE CONSTRAINT TRIGGER programme_match_proposal_result[\s\S]*?DEFERRABLE INITIALLY DEFERRED/);
  assert.match(coordinationMigration, /active_relationship_count \+ pending_proposal_count >= mentor_capacity/);
  assert.doesNotMatch(coordinationMigration, /CREATE OR REPLACE FUNCTION enforce_mentorship_capacity/);
});

test('Staff session scheduling records Staff authorship separately from participant responses', () => {
  assert.match(coordinationMigration, /ADD COLUMN coordinated_programme_id UUID/);
  assert.match(coordinationMigration, /ADD COLUMN coordinated_by_staff_user_id UUID/);
  assert.match(coordinationMigration, /CREATE TABLE programme_session_participation/);
  assert.match(coordinationMigration, /response IN \('pending', 'attended', 'missed'\)/);
  assert.match(coordinationMigration, /mentorship_sessions_creator_participant[\s\S]*?coordinated_by_staff_user_id/);
  assert.match(coordinationMigration, /programme_session_participation_actor/);
});
