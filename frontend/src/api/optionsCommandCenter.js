import apiClient from './client';

/** GET /v1/options-command-center/ -- macro SPY/QQQ levels, the
 * universe-wide ranking tables, and generated alerts, all derived from
 * persisted options snapshots. See the backend endpoint's docstring
 * (app/api/v1/options_command_center.py) for why individual ranking lists
 * can legitimately come back short or empty.
 *
 * `filters`: { universe: 'all'|'equities'|'etf', cap: 'all'|'mega'|'large' }
 * -- the Universal Filter Bar. Omit or pass 'all' for no filtering. */
export async function getOptionsCommandCenterSnapshot(filters = {}) {
  const params = {};
  if (filters.universe && filters.universe !== 'all') params.universe = filters.universe;
  if (filters.cap && filters.cap !== 'all') params.cap = filters.cap;
  const response = await apiClient.get('/v1/options-command-center/', { params });
  return response.data;
}
