export interface TeamDefinition {
  name: string;
  description: string;
  content: string;
  members: TeamMember[];
}

export interface TeamMember {
  name: string;
  description: string;
}

export interface TeamSummary {
  name: string;
  description: string;
}

export interface ActiveTeamState {
  name: string;
  activatedAt: string;
}

export interface RoleDefinition {
  name: string;
  content: string;
}

export interface RoleSummary {
  name: string;
}
