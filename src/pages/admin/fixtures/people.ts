import type { AdminFixture } from "@/lib/admin/dataSource";
import type { TeamMemberRow } from "@/lib/admin/people";
import type { PeopleFixture } from "@/pages/admin/views/people/useTeamMembers";

// Synthetic People & Access data for reference screens 03 and 04. Every
// address is on example.test and every id is a labelled example; nothing here
// is a real person, rooftop or tenant.

const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);

const member = (id: string, email: string, role: string, acceptedAt: string | null): TeamMemberRow => ({
  id,
  user_id: acceptedAt ? `example-user-${id}` : null,
  email: acceptedAt ? email : null,
  role,
  accepted_at: acceptedAt,
  invited_email: email,
});

// The five accepted members the reference pictures, in its order. The local parts give the
// reference's initials (ES, SA, IM, TC, GM), which are derived from the address.
export const EXAMPLE_MEMBERS: TeamMemberRow[] = [
  member("example-member-salesperson", "example.salesperson@example.test", "salesperson", "2026-03-11T13:15:00Z"),
  member("example-member-service", "service.advisor@example.test", "service_advisor", "2026-05-19T17:45:00Z"),
  member("example-member-inventory", "inventory.manager@example.test", "inventory_manager", "2026-04-02T12:00:00Z"),
  member("example-member-office", "title.clerk@example.test", "office", "2026-06-08T14:30:00Z"),
  member("example-member-gm", "general.manager@example.test", "general_manager", "2026-01-20T15:30:00Z"),
];

const PEOPLE: PeopleFixture = {
  viewerRole: "owner",
  viewerIsAdmin: false,
  selectedMemberId: "example-member-salesperson",
  members: EXAMPLE_MEMBERS,
  activity: [
    {
      id: "example-audit-1",
      action: "member_role_changed",
      entity_type: "tenant_member",
      entity_id: "example-member-inventory",
      user_email: "example.owner@example.test",
      details: { prev_role: "salesperson", new_role: "inventory_manager" },
      created_at: "2026-10-16T14:20:00Z",
    },
    {
      id: "example-audit-2",
      action: "settings_updated",
      entity_type: "tenant_member_role",
      entity_id: "example-member-inventory",
      user_email: "example.owner@example.test",
      details: { setting: "member_role", prev_role: "salesperson", new_role: "inventory_manager", reason: "Moved to the inventory desk" },
      created_at: "2026-10-16T14:20:02Z",
    },
  ],
};

const peopleFixture = (label: string, over: Partial<PeopleFixture> = {}): AdminFixture => ({
  label,
  now: NOW,
  views: { people: { ...PEOPLE, ...over } },
});

/** Screen 03: People & Access, Team tab, salesperson selected with the role summary open. */
export const FIXTURE_03 = peopleFixture("People & Access: Team");

/** Screen 04: Salesperson role child reached from Roles. */
export const FIXTURE_04 = peopleFixture("People & Access: Salesperson role");
