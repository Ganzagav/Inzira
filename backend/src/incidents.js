import { query } from './db.js';

// Reports are stored one row per edge; this folds them back into one row per report (group_id).
export async function listGroups(status = 'active', limit = 200) {
  const cond = status === 'active'
    ? 'cancelled_at IS NULL AND ends_at > now()'
    : `(cancelled_at IS NOT NULL OR ends_at <= now()) AND created_at > now() - interval '7 days'`;
  const q = await query(`
    SELECT group_id,
           (array_agg(type))[1] AS type, (array_agg(cause))[1] AS cause, MAX(level) AS level,
           (array_agg(note))[1] AS note, (array_agg(road_name))[1] AS road_name,
           MAX(lat) AS lat, MAX(lng) AS lng, MAX(radius_m) AS radius_m,
           (array_agg(created_by))[1] AS created_by, (array_agg(created_ref))[1] AS created_ref,
           MIN(created_at) AS created_at, MAX(ends_at) AS ends_at, MAX(cancelled_at) AS cancelled_at,
           COUNT(*)::int AS edges
    FROM incidents WHERE ${cond}
    GROUP BY group_id ORDER BY MIN(created_at) DESC LIMIT $1`, [limit]);
  return q.rows;
}
