import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProjectMemberRole } from '../integrations/app-data.types.js';
import { hasPermission } from '../collaboration/models/collaboration.model.js';

export interface ProjectAccess {
  userId: string;
  projectId: string;
  role: ProjectMemberRole;
  canWrite: boolean;
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase credentials are required for collaboration RBAC');
  }

  adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  return adminClient;
}

export async function resolveProjectAccess(
  userId: string,
  projectId: string,
  minimumRole: ProjectMemberRole = 'viewer',
): Promise<ProjectAccess> {
  const client = getAdminClient();

  const { data: project, error: projectError } = await client
    .from('project')
    .select('project_id, owner_user_id, status')
    .eq('project_id', projectId)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Project lookup failed: ${projectError.message}`);
  }
  if (!project || project.status === 'deleted') {
    throw new Error('Project not found');
  }

  let role: ProjectMemberRole | null = null;
  if (project.owner_user_id === userId) {
    role = 'owner';
  } else {
    const { data: member, error: memberError } = await client
      .from('project_member')
      .select('role, status')
      .eq('membership_id', `${projectId}:${userId}`)
      .maybeSingle();

    if (memberError) {
      throw new Error(`Membership lookup failed: ${memberError.message}`);
    }
    if (member?.status === 'active') {
      role = member.role as ProjectMemberRole;
    }
  }

  if (!role || !hasPermission(role, minimumRole)) {
    throw new Error('Insufficient project permissions');
  }

  return {
    userId,
    projectId,
    role,
    canWrite: hasPermission(role, 'editor'),
  };
}
