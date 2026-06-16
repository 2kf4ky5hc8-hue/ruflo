// UI-only permission helpers. These mirror the database RLS rules so we can
// show/hide controls — but the database is the real enforcement point.
import type { UserRole } from './types';

export const isAdmin = (role?: UserRole): boolean => role === 'admin';

export const canManageAll = (role?: UserRole): boolean =>
  role === 'admin' || role === 'manager';

export const canCreateJobs = (role?: UserRole): boolean =>
  role === 'admin' || role === 'manager' || role === 'staff';

// Non-viewers can edit (the DB further restricts staff to their own jobs).
export const canEdit = (role?: UserRole): boolean =>
  role !== undefined && role !== 'viewer';
