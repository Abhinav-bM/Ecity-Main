-- The audit log is append-only. Enforced in the database, not just in code,
-- because application validation can be bypassed by a script or a bug.
-- PRD FR-31.1 / FR-31.2, docs/03 §4.3.

CREATE OR REPLACE FUNCTION audit_log_is_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING HINT = 'Audit entries are never edited or removed. Add a new entry instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- Email uniqueness must be case-insensitive. The application lower-cases on
-- the way in; this stops anything else creating a duplicate.
DROP INDEX IF EXISTS app_user_email_uq;
CREATE UNIQUE INDEX app_user_email_uq
  ON app_user (business_id, lower(email));

-- Extensions needed from M2 onward for partial IMEI and name search
-- (docs/03 §4.7). Created now so later migrations do not need superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
