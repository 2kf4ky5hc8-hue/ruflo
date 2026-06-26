// Shared TypeScript types + label maps for Atlas Core.

export type UserRole = 'admin' | 'manager' | 'staff' | 'viewer';

export type JobStage =
  | 'lead'
  | 'quoted'
  | 'accepted'
  | 'live'
  | 'snagging'
  | 'awaiting_payment'
  | 'complete';

export type PaymentStatus =
  | 'none'
  | 'deposit_due'
  | 'deposit_paid'
  | 'part_paid'
  | 'paid'
  | 'overdue';

export type AssignmentRole = 'manager' | 'team_member';

export type ContributionType =
  | 'lead_in'
  | 'phone_call'
  | 'survey_quote'
  | 'follow_up'
  | 'project_management'
  | 'variations'
  | 'payment_collection'
  | 'aftercare_snags'
  | 'other';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  active: boolean;
}

export interface Job {
  id: string;
  job_name: string;
  client_name: string | null;
  site_address: string | null;
  client_id: string | null;
  property_id: string | null;
  stage: JobStage;
  assigned_manager: string | null;
  lead_source: string | null;
  estimated_value: number | null;
  amount_outstanding: number | null;
  payment_status: PaymentStatus;
  next_action: string | null;
  next_action_due: string | null;
  notes: string | null;
  xero_contact_ref: string | null;
  xero_invoice_ref: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  position: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  client_id: string;
  label: string | null;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  postcode: string | null;
  notes: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobAssignment {
  id: string;
  job_id: string;
  user_id: string;
  role: AssignmentRole;
  assigned_by: string | null;
  created_at: string;
}

export interface JobContribution {
  id: string;
  job_id: string;
  user_id: string;
  contribution_type: ContributionType;
  description: string | null;
  occurred_at: string;
  added_by: string | null;
  created_at: string;
}

export interface JobActivity {
  id: string;
  job_id: string;
  actor: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export const STAGES: { value: JobStage; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'accepted', label: 'Accepted / Deposit Due' },
  { value: 'live', label: 'Live' },
  { value: 'snagging', label: 'Snagging' },
  { value: 'awaiting_payment', label: 'Awaiting Payment' },
  { value: 'complete', label: 'Complete' },
];

export const PAYMENT_STATUSES: { value: PaymentStatus; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'deposit_due', label: 'Deposit due' },
  { value: 'deposit_paid', label: 'Deposit paid' },
  { value: 'part_paid', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
];

export const CONTRIBUTION_TYPES: { value: ContributionType; label: string }[] = [
  { value: 'lead_in', label: 'Brought in the lead' },
  { value: 'phone_call', label: 'Handled phone call' },
  { value: 'survey_quote', label: 'Surveyed / quoted' },
  { value: 'follow_up', label: 'Followed up' },
  { value: 'project_management', label: 'Managed the project' },
  { value: 'variations', label: 'Closed variations' },
  { value: 'payment_collection', label: 'Helped collect payment' },
  { value: 'aftercare_snags', label: 'Aftercare / snags' },
  { value: 'other', label: 'Other' },
];

export const stageLabel = (v?: string | null): string =>
  STAGES.find((s) => s.value === v)?.label ?? v ?? '';
export const paymentLabel = (v?: string | null): string =>
  PAYMENT_STATUSES.find((s) => s.value === v)?.label ?? v ?? '';
export const contributionLabel = (v?: string | null): string =>
  CONTRIBUTION_TYPES.find((s) => s.value === v)?.label ?? v ?? '';

export const propertyLabel = (
  p: Pick<Property, 'label' | 'address_line1' | 'town' | 'postcode'>,
): string =>
  p.label?.trim() ||
  [p.address_line1, p.town, p.postcode].filter(Boolean).join(', ') ||
  'Unnamed property';
