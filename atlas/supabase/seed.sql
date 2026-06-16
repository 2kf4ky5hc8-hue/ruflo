-- =============================================================================
-- Atlas Core v1 — one-time seed / admin setup
-- Run AFTER schema.sql and AFTER the first users have been created in
-- Supabase Auth (Dashboard > Authentication > Users > Add user).
-- =============================================================================

-- 1) Promote the first admin (change the email to the real one).
update profiles set role = 'admin' where email = 'james@cubittwren.co.uk';

-- 2) Set other roles as needed:
-- update profiles set role = 'manager' where email = 'someone@cubittwren.co.uk';
-- update profiles set role = 'staff'   where email = 'someone@cubittwren.co.uk';
-- update profiles set role = 'viewer'  where email = 'someone@cubittwren.co.uk';

-- 3) (Optional) verify everyone's role:
-- select email, full_name, role, active from profiles order by role, email;
