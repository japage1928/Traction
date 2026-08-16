-- ===========================================================================
-- Adds Pinterest to the platform enum.
--
-- This lives in its own migration on purpose. Postgres will not let a newly
-- added enum value be USED in the same transaction that added it, and the
-- Supabase SQL editor wraps a pasted script in one transaction. Run this file
-- on its own and let it commit before running 0003.
-- ===========================================================================

alter type platform add value if not exists 'pinterest';
