-- Study groups: shared deadlines + invite links for group projects.
-- Unlike every other table in this schema (single-owner `auth.uid() = user_id`),
-- these tables need multi-user reads scoped to shared group membership.
-- group_shared_items is a deliberately denormalized bridge table (not a live
-- join into tasks/events) so the private tasks/events tables stay untouched --
-- only what a member explicitly opts to share becomes visible to the group.

create table if not exists study_groups (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  subject     text,
  created_at  timestamptz not null default now()
);

create table if not exists group_members (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references study_groups(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        text        not null default 'member' check (role in ('owner','member')),
  joined_at   timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists group_invites (
  id          uuid        primary key default gen_random_uuid(),
  token       text        not null unique default encode(gen_random_bytes(16), 'hex'),
  group_id    uuid        not null references study_groups(id) on delete cascade,
  created_by  uuid        not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '14 days',
  used_by     uuid[]      not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists group_shared_items (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references study_groups(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  item_type   text        not null check (item_type in ('task','event')),
  item_id     text        not null,
  title       text        not null,
  due_date    date,
  subject     text,
  created_at  timestamptz not null default now(),
  unique (group_id, user_id, item_type, item_id)
);

create index group_members_group_idx on group_members(group_id);
create index group_members_user_idx on group_members(user_id);
create index group_invites_token_idx on group_invites(token);
create index group_invites_group_idx on group_invites(group_id);
create index group_shared_items_group_idx on group_shared_items(group_id, due_date);

alter table study_groups enable row level security;
alter table group_members enable row level security;
alter table group_invites enable row level security;
alter table group_shared_items enable row level security;

-- study_groups: any member can read; only the owner can write/update/delete.
create policy "group_members_read_group" on study_groups for select
  using (id in (select group_id from group_members where user_id = auth.uid()));
create policy "group_owner_insert_group" on study_groups for insert
  with check (owner_id = auth.uid());
create policy "group_owner_update_group" on study_groups for update
  using (owner_id = auth.uid());
create policy "group_owner_delete_group" on study_groups for delete
  using (owner_id = auth.uid());

-- group_members: self-referencing select policy so a member can see fellow
-- members of any group they belong to (needed for "N of M members" counts),
-- not just their own membership row.
create policy "group_members_read_shared" on group_members for select
  using (group_id in (select gm2.group_id from group_members gm2 where gm2.user_id = auth.uid()));
create policy "group_members_self_insert" on group_members for insert
  with check (user_id = auth.uid());
create policy "group_members_self_delete" on group_members for delete
  using (user_id = auth.uid());

-- group_invites: members can read/copy the link; only the creator can revoke.
-- No insert/select policy grants access to non-members; a brand-new user
-- redeeming a token does so through a service-role edge function, never
-- through client-side RLS (they aren't a member yet, so they couldn't pass
-- these policies regardless).
create policy "group_invites_read_members" on group_invites for select
  using (group_id in (select group_id from group_members where user_id = auth.uid()));
create policy "group_invites_member_insert" on group_invites for insert
  with check (
    created_by = auth.uid()
    and group_id in (select group_id from group_members where user_id = auth.uid())
  );
create policy "group_invites_creator_delete" on group_invites for delete
  using (created_by = auth.uid());

-- group_shared_items: any member of the group can read any member's shared
-- item -- this is the point (peer comparison). Only the sharer can write or
-- unshare their own item.
create policy "group_shared_items_read_members" on group_shared_items for select
  using (group_id in (select group_id from group_members where user_id = auth.uid()));
create policy "group_shared_items_owner_insert" on group_shared_items for insert
  with check (
    user_id = auth.uid()
    and group_id in (select group_id from group_members where user_id = auth.uid())
  );
create policy "group_shared_items_owner_delete" on group_shared_items for delete
  using (user_id = auth.uid());
