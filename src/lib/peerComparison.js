// Pure aggregation over already-fetched group_shared_items + group_members
// rows -- computes "N of M group members also have this due" without any
// extra query or table. Two shared items are treated as "the same deadline"
// when they match on item_type + title (case-insensitive) + due_date.

function itemKey(item) {
  return [item.item_type, (item.title || '').trim().toLowerCase(), item.due_date || ''].join('|');
}

// Returns a Map<itemKey, { title, due_date, item_type, subject, userIds: Set }>
export function groupSharedItemsByDeadline(sharedItems) {
  const map = new Map();
  for (const item of sharedItems || []) {
    const key = itemKey(item);
    if (!map.has(key)) {
      map.set(key, { title: item.title, due_date: item.due_date, item_type: item.item_type, subject: item.subject, userIds: new Set() });
    }
    map.get(key).userIds.add(item.user_id);
  }
  return map;
}

// For a single shared item row, how many of the group's members (including
// the sharer) also have the matching deadline shared, out of the group's
// total member count.
export function peerCountFor(item, sharedItems, memberCount) {
  const key = itemKey(item);
  const bucket = groupSharedItemsByDeadline(sharedItems).get(key);
  const have = bucket ? bucket.userIds.size : 1;
  return { have, of: Math.max(memberCount, have) };
}
